// packages/db/src/reconciliation.ts
// The CFO money-operations console (architecture doc §6.2): a disbursement
// queue (approved loans awaiting money-out) and payroll reconciliation
// (expected deductions this cycle vs. what actually posted). This is the
// hero the doc calls the "biggest real gap" — everything here was previously
// only reachable one loan at a time from its own detail page.
import type { Tx } from "./client";
import { cycleReport } from "./payroll";

export interface DisbursementQueueItem {
  loanId: string;
  borrower: string;
  product: string;
  amount: number;
  approvedAt: string;
}

/** Every loan awaiting money-out, tenant-wide, oldest first — the queue a
 *  disburser works down. */
export async function disbursementQueue(
  tx: Tx, tenantId: string,
): Promise<DisbursementQueueItem[]> {
  const rows = await tx`
    SELECT l.id, l.principal, l.created_at,
           e.full_name AS borrower, lp.name AS product
    FROM loans l
    JOIN loan_applications la ON la.id = l.application_id
    JOIN employees e ON e.id = la.employee_id
    JOIN loan_products lp ON lp.id = la.loan_product_id
    WHERE l.tenant_id = ${tenantId} AND l.status = 'pending_disbursement'
    ORDER BY l.created_at ASC`;
  return rows.map((r) => ({
    loanId: r.id as string,
    borrower: r.borrower as string,
    product: r.product as string,
    amount: Number(r.principal),
    approvedAt: new Date(r.created_at as string).toISOString(),
  }));
}

export interface ReconciliationException {
  loanId: string;
  borrower: string;
  product: string;
  expected: number;
  actual: number;
  shortfall: number;
}

export interface ReconciliationCycle {
  cycleLabel: string;       // e.g. "August 2026"
  expected: number;
  actual: number;
  exceptions: ReconciliationException[];
}

/** This calendar month's payroll cycle, from the SAME report the Payroll screen
 *  shows (payroll.ts cycleReport), so the dashboard and that screen can never
 *  disagree. Exceptions are loans short or missed once the month has closed; while
 *  it is still open an unpaid loan is simply "awaiting", not an exception. */
export async function reconciliationThisCycle(
  tx: Tx, tenantId: string,
): Promise<ReconciliationCycle> {
  const report = await cycleReport(tx, tenantId, new Date().toISOString().slice(0, 7));
  const exceptions: ReconciliationException[] = report.lines
    .filter((l) => l.status === "short" || l.status === "missed")
    .map((l) => ({
      loanId: l.loanId, borrower: l.name, product: l.product,
      expected: l.expected, actual: l.received, shortfall: l.remaining,
    }));
  return { cycleLabel: report.label, expected: report.totals.expected, actual: report.totals.received, exceptions };
}
