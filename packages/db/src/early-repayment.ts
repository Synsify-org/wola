// packages/db/src/early-repayment.ts
// Early repayment as a REQUEST -> RECORD flow.
//
// An employee (or HR, when someone is leaving) asks to pay a lump sum or the whole
// balance. Finance sees the request, and when the money has arrived records it with
// recordRepayment(source "early"), which does the rest the ledger already knows how
// to do: a lump sum re-amortizes the remaining schedule so the loan finishes
// sooner, and clearing the payoff settles the loan (balance zero). The request is
// the paper trail around that: who asked, for what, who recorded it, which
// repayment it became.
import type { Tx } from "./client";
import { EPS, round2 } from "./ledger";
import { recordRepayment, repaymentPosition } from "./loans";

export interface EarlyRepaymentRequest {
  id: string;
  loanId: string;
  kind: "full" | "partial";
  amount: number | null;
  quotedPayoff: number;
  reason: string | null;
  status: "requested" | "paid" | "declined" | "cancelled";
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  requestedBy: string | null;
}

const map = (r: Record<string, unknown>): EarlyRepaymentRequest => ({
  id: r.id as string,
  loanId: r.loan_id as string,
  kind: r.kind as "full" | "partial",
  amount: r.amount === null ? null : Number(r.amount),
  quotedPayoff: Number(r.quoted_payoff),
  reason: (r.reason as string | null) ?? null,
  status: r.status as EarlyRepaymentRequest["status"],
  createdAt: new Date(r.created_at as string).toISOString(),
  decidedAt: r.decided_at ? new Date(r.decided_at as string).toISOString() : null,
  decisionNote: (r.decision_note as string | null) ?? null,
  requestedBy: (r.requested_by as string | null) ?? null,
});

export async function listEarlyRepaymentRequests(
  tx: Tx, tenantId: string, opts: { loanId?: string; status?: string } = {},
): Promise<(EarlyRepaymentRequest & { borrower: string; employeeNo: string; product: string })[]> {
  const rows = await tx`
    SELECT er.*, e.full_name AS borrower, e.employee_no, lp.name AS product
    FROM early_repayment_requests er
    JOIN loans l ON l.id = er.loan_id
    JOIN loan_applications la ON la.id = l.application_id
    JOIN employees e ON e.id = la.employee_id
    JOIN loan_products lp ON lp.id = la.loan_product_id
    WHERE er.tenant_id = ${tenantId}
      AND (${opts.loanId ?? null}::uuid IS NULL OR er.loan_id = ${opts.loanId ?? null}::uuid)
      AND (${opts.status ?? null}::text IS NULL OR er.status = ${opts.status ?? null}::text)
    ORDER BY er.created_at DESC`;
  return rows.map((r) => ({ ...map(r), borrower: r.borrower as string, employeeNo: r.employee_no as string, product: r.product as string }));
}

export type RequestResult = { ok: true; id: string; payoff: number } | { ok: false; error: string };

/** Ask to repay early. `requestedBy` must be the borrower unless `onBehalf` is set
 *  (HR recovering a balance when someone leaves). */
export async function requestEarlyRepayment(
  tx: Tx,
  args: { tenantId: string; loanId: string; requestedBy: string; kind: "full" | "partial"; amount?: number | null; reason?: string | null; onBehalf?: boolean },
): Promise<RequestResult> {
  const [loan] = await tx`
    SELECT l.status, e.user_id AS borrower_user
    FROM loans l JOIN loan_applications la ON la.id = l.application_id JOIN employees e ON e.id = la.employee_id
    WHERE l.tenant_id = ${args.tenantId} AND l.id = ${args.loanId}`;
  if (!loan) return { ok: false, error: "Loan not found." };
  if (!args.onBehalf && loan.borrower_user !== args.requestedBy) return { ok: false, error: "You can only ask to repay your own loan." };
  if (loan.status !== "active") return { ok: false, error: "Only a running loan can be repaid early." };

  const pos = await repaymentPosition(tx, args.tenantId, args.loanId);
  if (args.kind === "partial") {
    const amt = round2(Number(args.amount));
    if (!(amt > 0)) return { ok: false, error: "Enter the amount you want to pay." };
    if (amt >= pos.payoff - EPS) return { ok: false, error: `That covers the whole balance. Choose "Pay off in full" (${pos.payoff}).` };
  }

  try {
    const [row] = await tx.savepoint((sp) => sp`
      INSERT INTO early_repayment_requests (tenant_id, loan_id, kind, amount, quoted_payoff, reason, requested_by)
      VALUES (${args.tenantId}, ${args.loanId}, ${args.kind}, ${args.kind === "partial" ? round2(Number(args.amount)) : null},
              ${pos.payoff}, ${args.reason?.trim() || null}, ${args.requestedBy})
      RETURNING id`);
    return { ok: true, id: row.id as string, payoff: pos.payoff };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return { ok: false, error: "There is already an open request for this loan." };
    throw e;
  }
}

export type RecordResult =
  | { ok: true; amount: number; outstanding: number; settled: boolean; reamortized: boolean }
  | { ok: false; error: string };

/** Finance confirms the money arrived and records it. For "pay off in full" the
 *  amount is the payoff AS OF NOW (interest owed to the current instalment plus
 *  outstanding principal); for a lump sum it is the amount asked for. */
export async function recordEarlyRepayment(
  tx: Tx, args: { tenantId: string; requestId: string; actorId: string },
): Promise<RecordResult> {
  const [req] = await tx`
    SELECT id, loan_id, kind, amount, status FROM early_repayment_requests
    WHERE tenant_id = ${args.tenantId} AND id = ${args.requestId} FOR UPDATE`;
  if (!req) return { ok: false, error: "Request not found." };
  if (req.status !== "requested") return { ok: false, error: `This request is already ${req.status}.` };

  const pos = await repaymentPosition(tx, args.tenantId, req.loan_id as string);
  if (pos.status !== "active") return { ok: false, error: `The loan is '${pos.status}', so there is nothing to repay.` };
  const amount = req.kind === "full" ? pos.payoff : Math.min(Number(req.amount), pos.payoff);
  if (!(amount > 0)) return { ok: false, error: "Nothing is owed on this loan." };

  const r = await recordRepayment(tx, {
    tenantId: args.tenantId, loanId: req.loan_id as string, amount, source: "early", postedBy: args.actorId,
  });
  await tx`
    UPDATE early_repayment_requests
    SET status = 'paid', decided_by = ${args.actorId}, decided_at = now(), repayment_id = ${r.repaymentId}
    WHERE tenant_id = ${args.tenantId} AND id = ${args.requestId}`;
  return { ok: true, amount, outstanding: r.outstanding, settled: r.settled, reamortized: r.reamortized };
}

/** Finance declines (needs a reason the borrower will see). */
export async function declineEarlyRepayment(
  tx: Tx, args: { tenantId: string; requestId: string; actorId: string; note: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!args.note.trim()) return { ok: false, error: "Give a reason, so the person knows why." };
  const res = await tx`
    UPDATE early_repayment_requests
    SET status = 'declined', decided_by = ${args.actorId}, decided_at = now(), decision_note = ${args.note.trim()}
    WHERE tenant_id = ${args.tenantId} AND id = ${args.requestId} AND status = 'requested' RETURNING id`;
  return res.length ? { ok: true } : { ok: false, error: "That request is no longer open." };
}

/** The person who asked withdraws it. */
export async function cancelEarlyRepayment(
  tx: Tx, args: { tenantId: string; requestId: string; userId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await tx`
    UPDATE early_repayment_requests SET status = 'cancelled', decided_at = now(), decided_by = ${args.userId}
    WHERE tenant_id = ${args.tenantId} AND id = ${args.requestId} AND status = 'requested' AND requested_by = ${args.userId}
    RETURNING id`;
  return res.length ? { ok: true } : { ok: false, error: "That request is no longer open, or isn't yours." };
}

/** Loan-exit policy. When someone leaves, what happens to a loan they still owe?
 *  Setting: tenants.settings.loanExit.policy
 *   - "recover_balance" (default): a request to pay the whole balance is opened for
 *     every running loan, so finance sees it in the Payroll queue and nothing is
 *     forgotten. It does not move money or change the loan until finance records it.
 *   - "manual": nothing is opened; the caller is only warned.
 *  Returns how many requests were opened. */
export async function openExitRepaymentRequests(
  tx: Tx, args: { tenantId: string; employeeId: string; actorId: string },
): Promise<{ policy: "recover_balance" | "manual"; opened: number; loans: number }> {
  const [t] = await tx`SELECT settings FROM tenants WHERE id = ${args.tenantId}`;
  const raw = ((t?.settings ?? {}) as { loanExit?: { policy?: string } }).loanExit?.policy;
  const policy = raw === "manual" ? "manual" : "recover_balance";
  const loans = await tx`
    SELECT l.id FROM loans l JOIN loan_applications la ON la.id = l.application_id
    WHERE l.tenant_id = ${args.tenantId} AND la.employee_id = ${args.employeeId} AND l.status = 'active'`;
  if (policy === "manual") return { policy, opened: 0, loans: loans.length };
  let opened = 0;
  for (const l of loans) {
    const r = await requestEarlyRepayment(tx, {
      tenantId: args.tenantId, loanId: l.id as string, requestedBy: args.actorId, kind: "full",
      reason: "Employee left the organisation", onBehalf: true,
    });
    if (r.ok) opened++; // an already-open request is fine: it is still being handled
  }
  return { policy, opened, loans: loans.length };
}
