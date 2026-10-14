// packages/db/src/bulk-invite.ts
// Invite many people at once from a list: employee number, role, and (optionally) work email. This is
// how an organisation with dozens of staff gets everyone a login without clicking through one by one.
//
// The email comes from the list if it has one, otherwise from the work email already saved on the
// employee (HR or an administrator types those into Settings -> Employees -> Fill in details). A person
// with no email anywhere is skipped, not treated as a mistake, so a list can be sent in stages.
//
// It only PLANS here (read-only): the list is parsed and every row is checked against the organisation's
// real data, so an administrator can see exactly what will happen before anything is sent. Sending goes
// through the same inviteToOrganisation + email path as a single invitation, in the web layer, so every
// existing rule (valid role, no duplicate access, one live link per email) still applies.
import { MEMBERSHIP_ROLES } from "@wola/engine";
import type { Tx } from "./client";

export const MAX_BULK_INVITES = 500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface BulkInviteRow { line: number; employeeNo: string; email: string; role: string }

/** Read the list. Needs an employee-number column; email and role columns are optional
 *  (role defaults to "employee"). Accepts the accounts.csv the staff tool writes. */
export function parseBulkInvites(text: string): { rows: BulkInviteRow[]; errors: string[] } {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], errors: ["The list is empty."] };
  const split = (l: string) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const iNo = col("employee_no", "employee no", "employee number", "employee_number");
  const iEmail = col("work_email", "email", "work email");
  const iRole = col("role", "suggested_role", "wola_role");
  if (iNo < 0) return { rows: [], errors: ['The first row must name the columns, including "employee_no". "work_email" and "role" are optional.'] };

  const rows: BulkInviteRow[] = [], errors: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = split(lines[i]);
    const employeeNo = (c[iNo] ?? "").toUpperCase().replace(/\s+/g, "");
    const email = iEmail >= 0 ? (c[iEmail] ?? "").toLowerCase() : "";
    const role = iRole >= 0 && c[iRole] ? c[iRole].toLowerCase() : "employee";
    if (!employeeNo && !email) continue;
    rows.push({ line: i + 1, employeeNo, email, role });
  }
  if (rows.length > MAX_BULK_INVITES) errors.push(`At most ${MAX_BULK_INVITES} people at a time (this list has ${rows.length}).`);
  return { rows, errors };
}

export interface PlannedInvite extends BulkInviteRow {
  employeeId: string | null;
  name: string | null;
  /** null = this row will be invited (unless skipped); otherwise why it will not. */
  problem: string | null;
  /** No email in the list or on file: left for later, not a mistake. */
  skipped: boolean;
}

/** Check each row against the organisation. Read-only. */
export async function planBulkInvites(tx: Tx, tenantId: string, rows: BulkInviteRow[]): Promise<PlannedInvite[]> {
  const nos = [...new Set(rows.map((r) => r.employeeNo).filter(Boolean))];
  const emps = nos.length
    ? await tx`SELECT id, employee_no, full_name, user_id, work_email FROM employees WHERE tenant_id = ${tenantId} AND employee_no = ANY(${nos}::text[])`
    : [];
  const byNo = new Map(emps.map((e) => [e.employee_no as string, e]));
  const effective = rows.map((r) => r.email || ((byNo.get(r.employeeNo)?.work_email as string | null)?.toLowerCase() ?? ""));

  const emails = [...new Set(effective.filter(Boolean))];
  const members = emails.length
    ? await tx`SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${tenantId} AND u.email = ANY(${emails}::text[])`
    : [];
  const haveAccess = new Set(members.map((m) => (m.email as string).toLowerCase()));
  const waiting = emails.length
    ? await tx`SELECT email FROM invitations WHERE tenant_id = ${tenantId} AND accepted_at IS NULL AND expires_at > now() AND email = ANY(${emails}::text[])`
    : [];
  const hasLiveInvite = new Set(waiting.map((w) => (w.email as string).toLowerCase()));

  const seenEmail = new Map<string, number>(), seenNo = new Map<string, number>();
  return rows.map((r, i) => {
    const emp = byNo.get(r.employeeNo);
    const email = effective[i];
    let problem: string | null = null, skipped = false;
    if (!r.employeeNo) problem = "No employee number.";
    else if (!emp) problem = `No employee ${r.employeeNo} in this organisation. Import the staff list first.`;
    else if (!(MEMBERSHIP_ROLES as readonly string[]).includes(r.role)) problem = `"${r.role}" is not a role Wola knows.`;
    else if (emp.user_id) problem = "Already has a login.";
    else if (!email) skipped = true;
    else if (!EMAIL_RE.test(email)) problem = `"${email}" is not a valid email address.`;
    else if (haveAccess.has(email)) problem = "That email already has access to this organisation.";
    else if (hasLiveInvite.has(email)) problem = "An invitation is already waiting for this email (resend it from the Access list if needed).";
    else if (seenEmail.has(email)) problem = `The same email is used on line ${seenEmail.get(email)}.`;
    else if (seenNo.has(r.employeeNo)) problem = `${r.employeeNo} appears again (line ${seenNo.get(r.employeeNo)}).`;
    if (!problem && !skipped) { seenEmail.set(email, r.line); seenNo.set(r.employeeNo, r.line); }
    return { ...r, email, employeeId: (emp?.id as string) ?? null, name: (emp?.full_name as string) ?? null, problem, skipped };
  });
}
