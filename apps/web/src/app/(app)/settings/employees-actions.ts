"use server";
// Bulk employee import/update — HR's core dashboard tool. CSV, header row
// required, comma-separated. No quoted-field support in this pass — values
// must not contain commas. Idempotent: upsert by (tenant_id, employee_no), so
// re-running the same file twice is safe, and a row for an EXISTING
// employee_no just refreshes gross/net salary — this is also how a payroll
// refresh works. There is no separate "payroll" table or import path; salary
// lives on the employee row, so one import mechanism covers both.
import { requireSession } from "@/lib/guard";
import { EMPLOYEE_DATA_ROLES as HR_ROLES, ACCOUNT_CREATOR_ROLES, FINANCE_ROLES } from "@/lib/permissions";
import { audit, createInvitation, sendEmail, openExitRepaymentRequests } from "@wola/db";
import { PROVISIONAL_EMPLOYEE_NO_PREFIX } from "@wola/engine";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

// Account/login creation is an ADMINISTRATION action (architecture doc §6.2's
// capability model — "manage users" belongs to whoever holds the admin
// capability, HR by default, not every full-book role). Deliberately
// narrower than HR_ROLES above, which governs employee-DATA maintenance
// (import/edit/status) that legitimately stays open to the wider set.

const REQUIRED_COLUMNS = ["employee_no", "full_name", "gross_salary", "net_salary"] as const;

type ParsedRow = {
  row: number;
  employee_no: string;
  full_name: string;
  department: string | null;
  department_head_no: string | null;
  title: string | null;
  gross_salary: number;
  net_salary: number;
  is_post_probation: boolean;
  on_final_warning: boolean;
  work_email: string | null;
  review_note: string | null;
};

export type ImportResult =
  | { ok: true; created: number; updated: number }
  | { ok: false; error: string; rowErrors?: string[] };

const truthy = (v: string) => ["true", "yes", "1"].includes(v.trim().toLowerCase());

function parseCsv(text: string): { rows: ParsedRow[]; errors: string[] } {
  // Optional columns: work_email (where the invitation goes) and review_note (why a person needs a look).
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], errors: ["Empty file."] };

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const errors: string[] = [];
  for (const col of REQUIRED_COLUMNS) {
    if (!header.includes(col)) errors.push(`Missing required column "${col}".`);
  }
  if (errors.length > 0) return { rows: [], errors };

  const idx = (col: string) => header.indexOf(col);
  const get = (cells: string[], col: string) => {
    const c = idx(col);
    return c >= 0 ? (cells[c] ?? "").trim() : "";
  };

  const rows: ParsedRow[] = [];
  const seenNos = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    const rowNum = i; // 1-based data row, header excluded

    const employeeNo = get(cells, "employee_no");
    const fullName = get(cells, "full_name");
    const grossStr = get(cells, "gross_salary");
    const netStr = get(cells, "net_salary");

    if (!employeeNo) { errors.push(`Row ${rowNum}: missing employee_no.`); continue; }
    if (!fullName) { errors.push(`Row ${rowNum}: missing full_name.`); continue; }
    if (seenNos.has(employeeNo)) { errors.push(`Row ${rowNum}: duplicate employee_no "${employeeNo}" in this file.`); continue; }
    seenNos.add(employeeNo);

    const email = get(cells, "work_email").toLowerCase();
    if (email && !EMAIL_RE.test(email)) { errors.push(`Row ${rowNum}: work_email "${email}" is not a valid email address.`); continue; }

    const gross = Number(grossStr);
    const net = Number(netStr);
    if (!Number.isFinite(gross) || gross < 0) { errors.push(`Row ${rowNum}: gross_salary "${grossStr}" is not a valid non-negative number.`); continue; }
    if (!Number.isFinite(net) || net < 0) { errors.push(`Row ${rowNum}: net_salary "${netStr}" is not a valid non-negative number.`); continue; }

    rows.push({
      row: rowNum,
      employee_no: employeeNo,
      full_name: fullName,
      department: get(cells, "department") || null,
      department_head_no: get(cells, "department_head_no") || null,
      title: get(cells, "title") || null,
      gross_salary: gross,
      net_salary: net,
      is_post_probation: truthy(get(cells, "is_post_probation")),
      on_final_warning: truthy(get(cells, "on_final_warning")),
      work_email: email || null,
      review_note: get(cells, "review_note").slice(0, 500) || null,
    });
  }

  return { rows, errors };
}

export async function importEmployeesAction(csvText: string): Promise<ImportResult> {
  const { rows, errors } = parseCsv(csvText);
  if (errors.length > 0) {
    return {
      ok: false,
      error: `${errors.length} row${errors.length === 1 ? "" : "s"} failed validation — nothing was imported.`,
      rowErrors: errors,
    };
  }
  if (rows.length === 0) return { ok: false, error: "No data rows found." };

  return requireSession(async (tx, ctx) => {
    if (!HR_ROLES.includes(ctx.role)) {
      return { ok: false, error: "You don't have permission to import employees." };
    }

    let created = 0;
    let updated = 0;

    // Phase 1: upsert every row by (tenant_id, employee_no) WITHOUT resolving
    // department_head_id yet — the head might be another row in this same
    // file that doesn't exist as a row in `employees` until this loop runs.
    for (const r of rows) {
      const [existing] = await tx`
        SELECT id FROM employees WHERE tenant_id = ${ctx.tenantId} AND employee_no = ${r.employee_no}`;
      await tx`
        INSERT INTO employees
          (tenant_id, employee_no, full_name, department, title,
           gross_salary, net_salary, is_post_probation, on_final_warning, work_email, review_note)
        VALUES
          (${ctx.tenantId}, ${r.employee_no}, ${r.full_name}, ${r.department}, ${r.title},
           ${r.gross_salary}, ${r.net_salary}, ${r.is_post_probation}, ${r.on_final_warning}, ${r.work_email}, ${r.review_note})
        ON CONFLICT (tenant_id, employee_no) DO UPDATE SET
          -- An email in the file fills the gap; a blank never erases one HR typed in. A review note is
          -- only ever set when a person is first loaded, so re-importing never re-flags what HR settled.
          work_email = COALESCE(EXCLUDED.work_email, employees.work_email),
          full_name = EXCLUDED.full_name,
          department = EXCLUDED.department,
          title = EXCLUDED.title,
          gross_salary = EXCLUDED.gross_salary,
          net_salary = EXCLUDED.net_salary,
          is_post_probation = EXCLUDED.is_post_probation,
          on_final_warning = EXCLUDED.on_final_warning,
          updated_at = now()`;
      if (existing) updated++; else created++;
    }

    // Phase 2: now that every row in the batch exists as a real employee,
    // resolve department_head_id links.
    for (const r of rows) {
      if (!r.department_head_no) continue;
      await tx`
        UPDATE employees SET department_head_id = (
          SELECT id FROM employees WHERE tenant_id = ${ctx.tenantId} AND employee_no = ${r.department_head_no}
        )
        WHERE tenant_id = ${ctx.tenantId} AND employee_no = ${r.employee_no}`;
    }

    await audit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "employees.bulk_import",
      entity: "employee",
      after: { created, updated, rows: rows.length },
    });

    revalidatePath("/settings/employees");
    return { ok: true, created, updated };
  });
}

// ---- Account creation (invite, not hardcode — spec §7.4) -----------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INVITE_TEMPLATE = {
  subject: "You've been invited to join {{tenantName}} on Wola",
  html:
    "<p>{{inviterName}} has invited you to join {{tenantName}} on Wola as {{role}}.</p>" +
    "<p><a href=\"{{inviteUrl}}\">Accept the invitation</a> — this link expires in 7 days.</p>",
};

export type CreateAccountResult =
  | { ok: true; email: string }
  | { ok: false; error: string };

/** Invite an employee to create their own login — no password is ever
 *  generated or seen by HR (that was the old stopgap). The invitee sets
 *  their own password (or, if this email already has a Wola account from
 *  another tenant, just confirms joining) via /accept-invite. */
export async function createAccountAction(
  employeeId: string,
  email: string,
): Promise<CreateAccountResult> {
  const trimmedEmail = email.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmedEmail)) return { ok: false, error: "Enter a valid email address." };

  const h = await headers();
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
  const origin = `${protocol}://${h.get("host")}`;

  return requireSession(async (tx, ctx) => {
    if (!ACCOUNT_CREATOR_ROLES.includes(ctx.role)) {
      return { ok: false, error: "You don't have permission to create employee accounts." };
    }

    const [emp] = await tx`
      SELECT id, full_name FROM employees
      WHERE tenant_id = ${ctx.tenantId} AND id = ${employeeId}`;
    if (!emp) return { ok: false, error: "Employee not found." };

    const [inviter] = await tx`
      SELECT e.full_name, u.email FROM users u LEFT JOIN employees e ON e.user_id = u.id
      WHERE u.id = ${ctx.userId}`;
    const [tenant] = await tx`SELECT name FROM tenants WHERE id = ${ctx.tenantId}`;

    let issued;
    try {
      issued = await createInvitation(tx, {
        tenantId: ctx.tenantId, email: trimmedEmail, role: "employee",
        employeeId, invitedById: ctx.userId,
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Failed to create invitation." };
    }

    await sendEmail(tx, {
      tenantId: ctx.tenantId,
      to: trimmedEmail,
      template: INVITE_TEMPLATE,
      data: {
        tenantName: (tenant?.name as string) ?? "Wola",
        inviterName: (inviter?.full_name as string) ?? (inviter?.email as string) ?? "A colleague",
        role: "Employee",
        inviteUrl: `${origin}/accept-invite?token=${issued.token}`,
      },
    });

    await audit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "employees.invited",
      entity: "employee",
      entityId: employeeId,
      after: { email: trimmedEmail },
    });

    revalidatePath("/settings/employees");
    return { ok: true, email: trimmedEmail };
  });
}

// ---- Single-employee edit + deactivate -------------------------------

export type EmployeeUpdate = {
  full_name: string;
  department: string | null;
  department_head_no: string | null;
  title: string | null;
  gross_salary: number;
  net_salary: number;
  is_post_probation: boolean;
  on_final_warning: boolean;
  /** Only changes anything while the current number is a provisional one (TEMP-...). */
  employee_no: string;
  work_email: string | null;
  /** Clear the "needs a look" flag: HR has settled it. */
  resolve_review: boolean;
};

export type ActionResult = { ok: true; note?: string } | { ok: false; error: string };

/** Correct one employee's own record — not a substitute for the bulk import
 *  for routine payroll refreshes, but for the odd typo/promotion that
 *  doesn't warrant re-uploading the whole CSV. */
export async function updateEmployeeAction(
  employeeId: string,
  fields: EmployeeUpdate,
): Promise<ActionResult> {
  if (!fields.full_name.trim()) return { ok: false, error: "Enter the employee's name." };
  if (!Number.isFinite(fields.gross_salary) || fields.gross_salary < 0) return { ok: false, error: "Gross salary must be a non-negative number." };
  if (!Number.isFinite(fields.net_salary) || fields.net_salary < 0) return { ok: false, error: "Net salary must be a non-negative number." };
  const workEmail = fields.work_email?.trim().toLowerCase() || null;
  if (workEmail && !EMAIL_RE.test(workEmail)) return { ok: false, error: "Enter a valid work email address." };

  return requireSession(async (tx, ctx) => {
    if (!HR_ROLES.includes(ctx.role)) {
      return { ok: false, error: "You don't have permission to edit employees." };
    }

    const [emp] = await tx`SELECT id, employee_no FROM employees WHERE tenant_id = ${ctx.tenantId} AND id = ${employeeId}`;
    if (!emp) return { ok: false, error: "Employee not found." };

    // A real employee number is the organisation's own key: it can be set once, while the current one is a stand-in.
    let employeeNo = emp.employee_no as string;
    const wanted = (fields.employee_no ?? "").trim().toUpperCase().replace(/\s+/g, "");
    if (wanted && wanted !== employeeNo) {
      if (!employeeNo.startsWith(PROVISIONAL_EMPLOYEE_NO_PREFIX)) return { ok: false, error: "An employee number cannot be changed once it is the real one." };
      if (wanted.startsWith(PROVISIONAL_EMPLOYEE_NO_PREFIX)) return { ok: false, error: "Enter the real employee number, not another temporary one." };
      const [taken] = await tx`SELECT 1 FROM employees WHERE tenant_id = ${ctx.tenantId} AND employee_no = ${wanted}`;
      if (taken) return { ok: false, error: `Another employee already has the number ${wanted}.` };
      employeeNo = wanted;
    }

    let departmentHeadId: string | null = null;
    if (fields.department_head_no) {
      const [head] = await tx`
        SELECT id FROM employees WHERE tenant_id = ${ctx.tenantId} AND employee_no = ${fields.department_head_no}`;
      if (!head) return { ok: false, error: `No employee with employee number "${fields.department_head_no}" was found, so they can't be set as department head.` };
      departmentHeadId = head.id as string;
    }

    await tx`
      UPDATE employees SET
        full_name = ${fields.full_name.trim()},
        department = ${fields.department},
        department_head_id = ${departmentHeadId},
        title = ${fields.title},
        gross_salary = ${fields.gross_salary},
        net_salary = ${fields.net_salary},
        is_post_probation = ${fields.is_post_probation},
        on_final_warning = ${fields.on_final_warning},
        employee_no = ${employeeNo},
        work_email = ${workEmail},
        review_note = CASE WHEN ${fields.resolve_review} THEN NULL ELSE review_note END,
        updated_at = now()
      WHERE tenant_id = ${ctx.tenantId} AND id = ${employeeId}`;

    await audit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "employees.updated",
      entity: "employee",
      entityId: employeeId,
      after: { ...fields, employee_no: employeeNo, work_email: workEmail },
    });

    revalidatePath("/settings/employees");
    return { ok: true };
  });
}

export type DetailsRow = {
  id: string;
  /** Only used while the current number is a provisional one; ignored otherwise. */
  employee_no: string;
  gross_salary: number;
  net_salary: number;
  is_post_probation: boolean;
  work_email: string | null;
};
export type DetailsResult =
  | { ok: true; saved: number }
  | { ok: false; error: string; rowErrors?: string[] };

/** Save the "fill in details" sheet: pay, probation status, work email and (while provisional) the
 *  real employee number, for many people at once. Every row is checked first and nothing is written if
 *  any row is wrong. Each person who actually changed gets their own audit entry with before and after,
 *  because pay and probation decide how much someone may borrow. */
export async function saveDetailsAction(rows: DetailsRow[]): Promise<DetailsResult> {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "Nothing to save." };
  if (rows.length > 500) return { ok: false, error: "Save at most 500 people at a time." };

  return requireSession(async (tx, ctx) => {
    if (!HR_ROLES.includes(ctx.role)) return { ok: false, error: "You don't have permission to edit employees." };

    const ids = rows.map((r) => r.id);
    const current = await tx`
      SELECT id, employee_no, full_name, gross_salary::float AS gross, net_salary::float AS net, is_post_probation, work_email
      FROM employees WHERE tenant_id = ${ctx.tenantId} AND id = ANY(${ids}::uuid[])`;
    const byId = new Map(current.map((c) => [c.id as string, c]));

    const errors: string[] = [];
    const numbersWanted = new Map<string, string>(); // new employee_no -> person, to catch duplicates inside this save
    const plan = rows.map((r) => {
      const c = byId.get(r.id);
      const who = (c?.full_name as string) ?? r.id;
      if (!c) { errors.push(`${who}: not found.`); return null; }
      if (!Number.isFinite(r.gross_salary) || r.gross_salary < 0) errors.push(`${who}: gross pay must be a number, 0 or more.`);
      if (!Number.isFinite(r.net_salary) || r.net_salary < 0) errors.push(`${who}: net pay must be a number, 0 or more.`);
      if (r.net_salary > r.gross_salary) errors.push(`${who}: net pay is more than gross pay. Check the two figures.`);
      const email = r.work_email?.trim().toLowerCase() || null;
      if (email && !EMAIL_RE.test(email)) errors.push(`${who}: "${email}" is not a valid email address.`);
      let employeeNo = c.employee_no as string;
      const wanted = (r.employee_no ?? "").trim().toUpperCase().replace(/\s+/g, "");
      if (wanted && wanted !== employeeNo && employeeNo.startsWith(PROVISIONAL_EMPLOYEE_NO_PREFIX)) {
        if (wanted.startsWith(PROVISIONAL_EMPLOYEE_NO_PREFIX)) errors.push(`${who}: enter the real employee number, not another temporary one.`);
        else if (numbersWanted.has(wanted)) errors.push(`${who}: ${wanted} is also used for ${numbersWanted.get(wanted)}.`);
        else { numbersWanted.set(wanted, who); employeeNo = wanted; }
      }
      return { r, c, who, email, employeeNo };
    });
    if (numbersWanted.size) {
      const taken = await tx`SELECT employee_no FROM employees WHERE tenant_id = ${ctx.tenantId} AND employee_no = ANY(${[...numbersWanted.keys()]}::text[])`;
      for (const t of taken) errors.push(`Another employee already has the number ${t.employee_no}.`);
    }
    if (errors.length) return { ok: false, error: `${errors.length} problem${errors.length === 1 ? "" : "s"}: nothing was saved.`, rowErrors: errors };

    let saved = 0;
    for (const p of plan) {
      if (!p) continue;
      const { r, c, email, employeeNo } = p;
      const unchanged =
        Number(c.gross) === r.gross_salary && Number(c.net) === r.net_salary &&
        Boolean(c.is_post_probation) === r.is_post_probation &&
        ((c.work_email as string | null)?.toLowerCase() ?? null) === email && employeeNo === c.employee_no;
      if (unchanged) continue;
      await tx`
        UPDATE employees SET gross_salary = ${r.gross_salary}, net_salary = ${r.net_salary},
          is_post_probation = ${r.is_post_probation}, work_email = ${email}, employee_no = ${employeeNo}, updated_at = now()
        WHERE tenant_id = ${ctx.tenantId} AND id = ${r.id}`;
      await audit(tx, {
        tenantId: ctx.tenantId, actorId: ctx.userId, action: "employees.updated", entity: "employee", entityId: r.id,
        before: { employee_no: c.employee_no, gross_salary: c.gross, net_salary: c.net, is_post_probation: c.is_post_probation, work_email: c.work_email },
        after: { employee_no: employeeNo, gross_salary: r.gross_salary, net_salary: r.net_salary, is_post_probation: r.is_post_probation, work_email: email },
      });
      saved++;
    }
    revalidatePath("/settings/employees");
    revalidatePath("/");
    return { ok: true, saved };
  });
}

/** Status flip. A loan is never changed or written off here. When someone is marked
 *  "exited" the organisation's loan-exit policy applies (openExitRepaymentRequests):
 *  by default a request to pay off the whole balance is opened for each running loan
 *  so finance sees it on the Payroll screen; the caller is told what happened. */
export async function setEmployeeStatusAction(
  employeeId: string,
  status: "active" | "exited" | "suspended",
): Promise<ActionResult> {
  return requireSession(async (tx, ctx) => {
    if (!HR_ROLES.includes(ctx.role)) {
      return { ok: false, error: "You don't have permission to change an employee's status." };
    }

    const [emp] = await tx`SELECT id, full_name FROM employees WHERE tenant_id = ${ctx.tenantId} AND id = ${employeeId}`;
    if (!emp) return { ok: false, error: "Employee not found." };

    const [activeLoan] = await tx`
      SELECT l.id FROM loans l
      JOIN loan_applications la ON la.id = l.application_id
      WHERE la.employee_id = ${employeeId} AND l.status = 'active'
      LIMIT 1`;

    await tx`
      UPDATE employees SET status = ${status}, updated_at = now()
      WHERE tenant_id = ${ctx.tenantId} AND id = ${employeeId}`;

    await audit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "employees.status_changed",
      entity: "employee",
      entityId: employeeId,
      after: { status, hadActiveLoan: Boolean(activeLoan) },
    });

    revalidatePath("/settings/employees");

    if (status === "exited" && activeLoan) {
      const exit = await openExitRepaymentRequests(tx, { tenantId: ctx.tenantId, employeeId, actorId: ctx.userId, notifyRoles: FINANCE_ROLES });
      if (exit.opened > 0) {
        await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, action: "loan.exit_recovery_opened", entity: "employee", entityId: employeeId, after: { requests: exit.opened } });
        revalidatePath("/payroll");
        return {
          ok: true,
          note: `${emp.full_name} has ${exit.loans === 1 ? "a running loan" : `${exit.loans} running loans`}. A request to recover the balance was sent to finance (Payroll screen); nothing is written off.`,
        };
      }
    }
    if (status !== "active" && activeLoan) {
      return {
        ok: true,
        note: `${emp.full_name} still has an active loan — this only changed their employee status. Handle the loan (settle/collect) separately.`,
      };
    }
    return { ok: true };
  });
}
