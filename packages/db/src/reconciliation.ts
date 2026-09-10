// packages/db/src/reconciliation.ts
// The CFO money-operations console (architecture doc §6.2): a disbursement
// queue (approved loans awaiting money-out) and payroll reconciliation
// (expected deductions this cycle vs. what actually posted). This is the
// hero the doc calls the "biggest real gap" — everything here was previously
// only reachable one loan at a time from its own detail page.
import type { Tx } from "./client";

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

/** This calendar month's payroll cycle: every active loan's instalment(s)
 *  due this month (expected) against what actually posted as a payroll
 *  repayment this month (actual), per loan. A loan with actual < expected
 *  is an exception — short or fully missed. Loans with nothing due this
 *  month are excluded entirely, not counted as a 0-expected non-issue. */
export async function reconciliationThisCycle(
  tx: Tx, tenantId: string,
): Promise<ReconciliationCycle> {
  const rows = await tx`
    SELECT l.id, e.full_name AS borrower, lp.name AS product,
           COALESCE(due.expected, 0) AS expected,
           COALESCE(paid.actual, 0) AS actual
    FROM loans l
    JOIN loan_applications la ON la.id = l.application_id
    JOIN employees e ON e.id = la.employee_id
    JOIN loan_products lp ON lp.id = la.loan_product_id
    JOIN LATERAL (
      SELECT sum(sl.instalment) AS expected
      FROM schedule_lines sl
      JOIN loan_schedules s ON s.id = sl.schedule_id
      WHERE s.loan_id = l.id AND s.is_active
        AND date_trunc('month', sl.due_date) = date_trunc('month', CURRENT_DATE)
    ) due ON true
    LEFT JOIN LATERAL (
      SELECT sum(r.amount) AS actual
      FROM repayments r
      WHERE r.loan_id = l.id AND r.source = 'payroll'
        AND date_trunc('month', r.value_date) = date_trunc('month', CURRENT_DATE)
    ) paid ON true
    WHERE l.tenant_id = ${tenantId} AND l.status = 'active'
      AND due.expected IS NOT NULL AND due.expected > 0`;

  let expected = 0;
  let actual = 0;
  const exceptions: ReconciliationException[] = [];

  for (const r of rows) {
    const exp = Number(r.expected);
    const act = Number(r.actual);
    expected += exp;
    actual += act;
    // Tolerance against float/rounding noise, not a real shortfall.
    if (exp - act > 0.5) {
      exceptions.push({
        loanId: r.id as string,
        borrower: r.borrower as string,
        product: r.product as string,
        expected: exp,
        actual: act,
        shortfall: exp - act,
      });
    }
  }

  const cycleLabel = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  return { cycleLabel, expected, actual, exceptions };
}
