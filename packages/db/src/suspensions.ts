// packages/db/src/suspensions.ts
// Payment holidays: an EVENT recorded against a loan. No schedule rows are added,
// changed or replaced; the loan's effective due dates move (engine suspension.ts),
// so what is "due now" and what the payroll cycle expects both honour it.
import { addMonthsIso, cycleBounds, windowsOverlap, type SuspensionWindow } from "@wola/engine";
import type { Tx } from "./client";
import { loanBorrower, notifyUsers } from "./inapp";

export interface Suspension {
  id: string;
  loanId: string;
  from: string;
  to: string;
  reason: string;
  createdAt: string;
  cancelled: boolean;
}

/** The windows that currently apply to a loan (cancelled ones excluded). */
export async function loadSuspensionWindows(tx: Tx, tenantId: string, loanId: string): Promise<SuspensionWindow[]> {
  const rows = await tx`
    SELECT to_char(from_date, 'YYYY-MM-DD') AS f, to_char(to_date, 'YYYY-MM-DD') AS t
    FROM loan_suspensions
    WHERE tenant_id = ${tenantId} AND loan_id = ${loanId} AND cancelled_at IS NULL
    ORDER BY from_date`;
  return rows.map((r) => ({ from: r.f as string, to: r.t as string }));
}

export async function listSuspensions(tx: Tx, tenantId: string, loanId: string): Promise<Suspension[]> {
  const rows = await tx`
    SELECT id, loan_id, to_char(from_date, 'YYYY-MM-DD') AS f, to_char(to_date, 'YYYY-MM-DD') AS t,
           reason, created_at, cancelled_at
    FROM loan_suspensions WHERE tenant_id = ${tenantId} AND loan_id = ${loanId}
    ORDER BY from_date DESC`;
  return rows.map((r) => ({
    id: r.id as string, loanId: r.loan_id as string, from: r.f as string, to: r.t as string,
    reason: r.reason as string, createdAt: new Date(r.created_at as string).toISOString(), cancelled: r.cancelled_at !== null,
  }));
}

export type SuspendResult = { ok: true; id: string; from: string; to: string; months: number } | { ok: false; error: string };

/** Pause instalments for whole calendar months. `from`/`to` may be any day in the
 *  first/last month: the window is widened to whole months so the rule is simple
 *  to explain ("no deduction in November"). */
export async function suspendLoan(
  tx: Tx,
  args: { tenantId: string; loanId: string; fromMonth: string; months: number; reason: string; actorId: string | null },
): Promise<SuspendResult> {
  const reason = args.reason.trim();
  if (!reason) return { ok: false, error: "Say why the payments are being paused." };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.fromMonth)) return { ok: false, error: "Pick the first month to pause." };
  if (!Number.isInteger(args.months) || args.months < 1 || args.months > 12) return { ok: false, error: "Pause between 1 and 12 months." };

  const from = `${args.fromMonth}-01`;
  const to = cycleBounds(addMonthsIso(from, args.months - 1).slice(0, 7)).end;

  const [loan] = await tx`
    SELECT status, to_char(start_date, 'YYYY-MM-DD') AS start_iso FROM loans
    WHERE tenant_id = ${args.tenantId} AND id = ${args.loanId} FOR UPDATE`;
  if (!loan) return { ok: false, error: "Loan not found." };
  if (loan.status !== "active") return { ok: false, error: `Only an active loan can be paused; this one is '${loan.status}'.` };
  if (to < (loan.start_iso as string)) return { ok: false, error: "That is before the loan started." };

  const existing = await loadSuspensionWindows(tx, args.tenantId, args.loanId);
  if (existing.some((w) => windowsOverlap(w, { from, to }))) {
    return { ok: false, error: "This loan is already paused for part of that period." };
  }

  const [row] = await tx`
    INSERT INTO loan_suspensions (tenant_id, loan_id, from_date, to_date, reason, created_by)
    VALUES (${args.tenantId}, ${args.loanId}, ${from}::date, ${to}::date, ${reason}, ${args.actorId})
    RETURNING id`;
  const borrower = await loanBorrower(tx, args.tenantId, args.loanId);
  if (borrower) {
    await notifyUsers(tx, args.tenantId, [borrower.userId], {
      kind: "loan.paused", title: "Your loan payments are paused",
      body: `${borrower.product}: no deductions from ${from} to ${to}. Reason: ${reason}`, href: `/loans/${args.loanId}`,
    });
  }
  return { ok: true, id: row.id as string, from, to, months: args.months };
}

export async function cancelSuspension(
  tx: Tx, args: { tenantId: string; suspensionId: string; actorId: string | null },
): Promise<{ ok: true; loanId: string } | { ok: false; error: string }> {
  const res = await tx`
    UPDATE loan_suspensions SET cancelled_at = now(), cancelled_by = ${args.actorId}
    WHERE tenant_id = ${args.tenantId} AND id = ${args.suspensionId} AND cancelled_at IS NULL
    RETURNING loan_id`;
  return res.length ? { ok: true, loanId: res[0].loan_id as string } : { ok: false, error: "That pause is already cancelled or doesn't exist." };
}
