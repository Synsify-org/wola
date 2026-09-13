"use server";
// Bulk employee import/update — HR's core dashboard tool. CSV, header row
// required, comma-separated. No quoted-field support in this pass — values
// must not contain commas. Idempotent: upsert by (tenant_id, employee_no), so
// re-running the same file twice is safe, and a row for an EXISTING
// employee_no just refreshes gross/net salary — this is also how a payroll
// refresh works. There is no separate "payroll" table or import path; salary
// lives on the employee row, so one import mechanism covers both.
import { requireSession } from "@/lib/guard";
import { audit, createInvitation, sendEmail } from "@wola/db";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

const HR_ROLES = ["hr", "cfo", "ceo", "md", "coo", "group_ceo", "admin", "org_admin"];
// Account/login creation is an ADMINISTRATION action (architecture doc §6.2's
// capability model — "manage users" belongs to whoever holds the admin
// capability, HR by default, not every full-book role). Deliberately
// narrower than HR_ROLES above, which governs employee-DATA maintenance
// (import/edit/status) that legitimately stays open to the wider set.
const ACCOUNT_CREATOR_ROLES = ["hr", "admin", "org_admin"];

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
};

export type ImportResult =
  | { ok: true; created: number; updated: number }
  | { ok: false; error: string; rowErrors?: string[] };

const truthy = (v: string) => ["true", "yes", "1"].includes(v.trim().toLowerCase());

function parseCsv(text: string): { rows: ParsedRow[]; errors: string[] } {
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
      return { ok: false, error: "You are not authorised to import employees." };
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
           gross_salary, net_salary, is_post_probation, on_final_warning)
        VALUES
          (${ctx.tenantId}, ${r.employee_no}, ${r.full_name}, ${r.department}, ${r.title},
           ${r.gross_salary}, ${r.net_salary}, ${r.is_post_probation}, ${r.on_final_warning})
        ON CONFLICT (tenant_id, employee_no) DO UPDATE SET
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
      return { ok: false, error: "You are not authorised to create employee accounts." };
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
};

export type ActionResult = { ok: true; note?: string } | { ok: false; error: string };

/** Correct one employee's own record — not a substitute for the bulk import
 *  for routine payroll refreshes, but for the odd typo/promotion that
 *  doesn't warrant re-uploading the whole CSV. */
export async function updateEmployeeAction(
  employeeId: string,
  fields: EmployeeUpdate,
): Promise<ActionResult> {
  if (!fields.full_name.trim()) return { ok: false, error: "Name is required." };
  if (!Number.isFinite(fields.gross_salary) || fields.gross_salary < 0) return { ok: false, error: "Gross salary must be a non-negative number." };
  if (!Number.isFinite(fields.net_salary) || fields.net_salary < 0) return { ok: false, error: "Net salary must be a non-negative number." };

  return requireSession(async (tx, ctx) => {
    if (!HR_ROLES.includes(ctx.role)) {
      return { ok: false, error: "You are not authorised to edit employees." };
    }

    const [emp] = await tx`SELECT id FROM employees WHERE tenant_id = ${ctx.tenantId} AND id = ${employeeId}`;
    if (!emp) return { ok: false, error: "Employee not found." };

    let departmentHeadId: string | null = null;
    if (fields.department_head_no) {
      const [head] = await tx`
        SELECT id FROM employees WHERE tenant_id = ${ctx.tenantId} AND employee_no = ${fields.department_head_no}`;
      if (!head) return { ok: false, error: `No employee with employee_no "${fields.department_head_no}" found for department head.` };
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
        updated_at = now()
      WHERE tenant_id = ${ctx.tenantId} AND id = ${employeeId}`;

    await audit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "employees.updated",
      entity: "employee",
      entityId: employeeId,
      after: fields,
    });

    revalidatePath("/settings/employees");
    return { ok: true };
  });
}

/** Pure status flip — deliberately does NOT touch any loan. There is no
 *  write-off/settlement policy or loan status for "borrower exited" yet;
 *  building one is a bigger, separate decision than this action. If the
 *  employee has an active loan, the caller gets a warning `note` so it's
 *  not silently ignored, but nothing about the loan changes here. */
export async function setEmployeeStatusAction(
  employeeId: string,
  status: "active" | "exited" | "suspended",
): Promise<ActionResult> {
  return requireSession(async (tx, ctx) => {
    if (!HR_ROLES.includes(ctx.role)) {
      return { ok: false, error: "You are not authorised to change employee status." };
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

    if (status !== "active" && activeLoan) {
      return {
        ok: true,
        note: `${emp.full_name} still has an active loan — this only changed their employee status. Handle the loan (settle/collect) separately.`,
      };
    }
    return { ok: true };
  });
}
