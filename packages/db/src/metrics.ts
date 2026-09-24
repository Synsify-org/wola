// packages/db/src/metrics.ts
// Dashboard aggregates. Role-aware: the same page shows a different truth
// depending on who is looking.
//
// "Outstanding" is derived from the repayment LEDGER (principal minus actual
// repayments posted), matching loanOutstanding() in loans.ts — not a schedule
// projection. A projection would silently disagree with the true, auditable
// paid-down balance the moment any repayment lands off-schedule.
import type { Tx } from "./client";

export interface EmployeeMetrics {
  kind: "employee";
  activeLoans: number;
  outstanding: number;        // scheduled
  monthlyDeduction: number;   // sum of instalments across active loans
  nextDueDate: string | null;
  applicationsInFlight: number;
}

export interface ApproverMetrics {
  kind: "approver";
  awaitingMe: number;         // applications where I am the current approver
  totalExposure: number;      // ledger outstanding across the tenant
  activeLoans: number;
  principalDisbursed: number;
  interestBook: number;       // total interest across active schedules
  /** interestBook using only loans that already existed ~1 month ago
   *  (start_date <= 1 month back). An APPROXIMATION, not a true historical
   *  snapshot: a loan that went active->settled inside that window is
   *  excluded from both figures, which slightly overstates how much the
   *  "back then" number would really have been. Good enough for a directional
   *  delta chip; not a substitute for a real periodic KPI snapshot table. */
  interestBookPriorMonth: number;
  applicationsInFlight: number;
  rejectedThisYear: number;
}

/** What an ordinary employee sees: their own position. */
export async function employeeMetrics(
  tx: Tx,
  userId: string,
): Promise<EmployeeMetrics> {
  const [emp] = await tx`SELECT id FROM employees WHERE user_id = ${userId}`;
  if (!emp) {
    return {
      kind: "employee", activeLoans: 0, outstanding: 0,
      monthlyDeduction: 0, nextDueDate: null, applicationsInFlight: 0,
    };
  }

  // One row per active loan: its instalment, and the TRUE ledger outstanding.
  const loans = await tx`
    SELECT l.id,
           (SELECT sl.instalment FROM schedule_lines sl
             JOIN loan_schedules s ON s.id = sl.schedule_id
            WHERE s.loan_id = l.id AND s.is_active
            ORDER BY sl.period_no LIMIT 1) AS instalment,
           GREATEST(l.principal - COALESCE(
             (SELECT sum((r.allocation->>'principal')::numeric)
                FROM repayments r WHERE r.loan_id = l.id),
             0
           ), 0) AS outstanding,
           (SELECT MIN(sl.due_date) FROM schedule_lines sl
             JOIN loan_schedules s ON s.id = sl.schedule_id
            WHERE s.loan_id = l.id AND s.is_active
              AND sl.due_date > CURRENT_DATE) AS next_due
    FROM loans l
    JOIN loan_applications la ON la.id = l.application_id
    WHERE la.employee_id = ${emp.id} AND l.status = 'active'`;

  const [inFlight] = await tx`
    SELECT count(*)::int AS n FROM loan_applications
    WHERE employee_id = ${emp.id} AND status IN ('submitted','in_review')`;

  const dates = loans
    .map((l) => l.next_due as string | null)
    .filter((d): d is string => Boolean(d))
    .sort();

  return {
    kind: "employee",
    activeLoans: loans.length,
    outstanding: loans.reduce((s, l) => s + Number(l.outstanding ?? 0), 0),
    monthlyDeduction: loans.reduce((s, l) => s + Number(l.instalment ?? 0), 0),
    nextDueDate: dates[0] ?? null,
    applicationsInFlight: Number(inFlight.n),
  };
}

/** What a CFO / HR / CEO / dept head sees: the tenant's book, plus their queue.
 *  RLS scopes every query to the tenant; no WHERE tenant_id needed. */
export async function approverMetrics(
  tx: Tx,
  awaitingMe: number,
): Promise<ApproverMetrics> {
  const [book] = await tx`
    SELECT
      count(*)::int AS active_loans,
      COALESCE(sum(l.principal), 0) AS principal
    FROM loans l WHERE l.status = 'active'`;

  // TRUE ledger outstanding across every active loan.
  const [exposure] = await tx`
    SELECT COALESCE(sum(
      GREATEST(l.principal - COALESCE(
        (SELECT sum((r.allocation->>'principal')::numeric)
           FROM repayments r WHERE r.loan_id = l.id),
        0
      ), 0)
    ), 0) AS outstanding
    FROM loans l WHERE l.status = 'active'`;

  // Interest the book will earn if every loan runs to term.
  const [interest] = await tx`
    SELECT COALESCE(sum(sl.interest_due), 0) AS interest
    FROM schedule_lines sl
    JOIN loan_schedules s ON s.id = sl.schedule_id
    JOIN loans l ON l.id = s.loan_id
    WHERE s.is_active AND l.status = 'active'`;

  // Same figure, restricted to loans that already existed ~1 month ago —
  // see the interestBookPriorMonth caveat on ApproverMetrics.
  const [interestPrior] = await tx`
    SELECT COALESCE(sum(sl.interest_due), 0) AS interest
    FROM schedule_lines sl
    JOIN loan_schedules s ON s.id = sl.schedule_id
    JOIN loans l ON l.id = s.loan_id
    WHERE s.is_active AND l.status = 'active'
      AND l.start_date <= CURRENT_DATE - INTERVAL '1 month'`;

  const [flight] = await tx`
    SELECT count(*)::int AS n FROM loan_applications
    WHERE status IN ('submitted','in_review')`;

  const [rejected] = await tx`
    SELECT count(*)::int AS n FROM loan_applications
    WHERE status = 'rejected'
      AND created_at >= date_trunc('year', CURRENT_DATE)`;

  return {
    kind: "approver",
    awaitingMe,
    totalExposure: Number(exposure.outstanding),
    activeLoans: Number(book.active_loans),
    principalDisbursed: Number(book.principal),
    interestBook: Number(interest.interest),
    interestBookPriorMonth: Number(interestPrior.interest),
    applicationsInFlight: Number(flight.n),
    rejectedThisYear: Number(rejected.n),
  };
}

/** Loans by product — the mix, for the register and the dashboard. */
export async function loansByProduct(tx: Tx) {
  return tx`
    SELECT lp.name, lp.kind,
           count(*)::int AS n,
           COALESCE(sum(l.principal), 0) AS principal
    FROM loans l
    JOIN loan_applications la ON la.id = l.application_id
    JOIN loan_products lp ON lp.id = la.loan_product_id
    WHERE l.status = 'active'
    GROUP BY lp.name, lp.kind
    ORDER BY principal DESC`;
}

export interface CollectionsPoint {
  /** Short month label, e.g. "Sep 26". */
  label: string;
  /** First day of the month, ISO date (YYYY-MM-DD). */
  month: string;
  /** Instalments falling due that month on each loan's ACTIVE schedule. */
  expected: number;
  /** Money actually received that month (every repayment source). */
  collected: number;
  /** True for the current calendar month (still in progress). */
  current: boolean;
}

/** Month-by-month collections: what the schedules said would come back vs
 *  what the ledger shows actually came back — the lending equivalent of
 *  "sales vs goals". Covers the last `months` months including this one,
 *  zero-filled so a month with no activity still plots.
 *
 *  Expected counts loans that are active OR settled (a settled loan still
 *  had instalments due in the months before it closed); an active schedule
 *  keeps its already-due periods through re-amortization, so history stays
 *  stable. Collected counts every source (payroll, manual, early) — this is
 *  cash in, unlike reconciliationThisCycle(), which isolates payroll to find
 *  deduction exceptions. RLS scopes every table to the caller's tenant. */
export async function collectionsTrend(tx: Tx, months = 6): Promise<CollectionsPoint[]> {
  const n = Math.max(1, Math.min(24, Math.floor(months)));
  const rows = await tx`
    WITH m AS (
      SELECT generate_series(
        date_trunc('month', CURRENT_DATE) - make_interval(months => ${n - 1}),
        date_trunc('month', CURRENT_DATE),
        interval '1 month'
      )::date AS month
    ),
    due AS (
      SELECT date_trunc('month', sl.due_date)::date AS month, sum(sl.instalment) AS expected
      FROM schedule_lines sl
      JOIN loan_schedules s ON s.id = sl.schedule_id AND s.is_active
      JOIN loans l ON l.id = s.loan_id AND l.status IN ('active', 'settled')
      GROUP BY 1
    ),
    paid AS (
      SELECT date_trunc('month', r.value_date)::date AS month, sum(r.amount) AS collected
      FROM repayments r
      GROUP BY 1
    )
    SELECT to_char(m.month, 'Mon YY') AS label,
           to_char(m.month, 'YYYY-MM-DD') AS month,
           COALESCE(due.expected, 0) AS expected,
           COALESCE(paid.collected, 0) AS collected,
           m.month = date_trunc('month', CURRENT_DATE)::date AS current
    FROM m
    LEFT JOIN due ON due.month = m.month
    LEFT JOIN paid ON paid.month = m.month
    ORDER BY m.month`;
  return rows.map((r) => ({
    label: r.label as string,
    month: r.month as string,
    expected: Number(r.expected),
    collected: Number(r.collected),
    current: Boolean(r.current),
  }));
}
