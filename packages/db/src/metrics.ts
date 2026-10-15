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
  /** Interest actually received so far, from the repayment ledger's interest
   *  allocation — the lender's realised profit, as opposed to interestBook's
   *  projection. Counts settled loans too: that interest was earned. */
  interestCollected: number;
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
           COALESCE((SELECT lb.outstanding FROM loan_balances lb WHERE lb.loan_id = l.id), l.principal) AS outstanding,
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
      COALESCE((SELECT lb.outstanding FROM loan_balances lb WHERE lb.loan_id = l.id), l.principal)
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

  const [collected] = await tx`
    SELECT COALESCE(sum((r.allocation->>'interest')::numeric), 0) AS interest
    FROM repayments r`;

  return {
    kind: "approver",
    awaitingMe,
    totalExposure: Number(exposure.outstanding),
    activeLoans: Number(book.active_loans),
    principalDisbursed: Number(book.principal),
    interestBook: Number(interest.interest),
    interestCollected: Number(collected.interest),
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

export interface InterestMonth {
  /** YYYY-MM */
  month: string;
  /** Short month label, e.g. "Sep 26". */
  label: string;
  /** Interest falling due that month on the loans' ACTIVE schedules. */
  expected: number;
  /** Interest actually received that month (the interest part of every repayment). */
  collected: number;
  /** The current calendar month. */
  current: boolean;
  /** After the current month: expected only, nothing can have been collected yet. */
  future: boolean;
}
export interface InterestByProduct { product: string; expected: number; collected: number }
export interface InterestReport {
  from: string;
  to: string;
  months: InterestMonth[];
  byProduct: InterestByProduct[];
  totals: {
    expected: number;
    collected: number;
    /** Expected in months already over (before the current one): what collection is measured against. */
    expectedToDate: number;
    /** Collected in those same finished months. */
    collectedToDate: number;
    /** Expected this month (still in progress) and in the months after it. */
    expectedAhead: number;
  };
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthLabel = (ym: string) =>
  new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1))
    .toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
const addMonth = (ym: string, k: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + k, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** Interest expected vs collected for the months `from`..`to` (YYYY-MM, inclusive, at
 *  most 36 months), by month and by product. The CFO's interest report.
 *
 *  Expected = interest_due on each live loan's active schedule (an active schedule keeps
 *  its already-due periods through re-amortization, so history is stable). A settled loan
 *  counts only up to the day it was paid off: interest it would have earned after that
 *  is not expected any more. Payment holidays are not shifted here; they move instalments
 *  later without forgiving them, so totals over a longer range still agree.
 *  Collected = the interest part of every repayment, by value date (payroll, finance or
 *  early). Display only: balances still come from loan_balances. RLS scopes every table
 *  to the caller's tenant. */
export async function interestReport(tx: Tx, args: { from: string; to: string }): Promise<InterestReport> {
  if (!MONTH_RE.test(args.from) || !MONTH_RE.test(args.to)) throw new Error("Months must be YYYY-MM.");
  let { from, to } = args;
  if (from > to) [from, to] = [to, from];
  if (addMonth(from, 35) < to) to = addMonth(from, 35);
  const start = `${from}-01`;
  const endExclusive = `${addMonth(to, 1)}-01`;

  const [{ today }] = await tx`SELECT to_char(CURRENT_DATE, 'YYYY-MM') AS today`;
  const rows = await tx`
    WITH live AS (
      SELECT l.id, l.status, lp.name AS product,
             CASE WHEN l.status = 'settled'
                  THEN (SELECT max(r.value_date) FROM repayments r WHERE r.loan_id = l.id) END AS closed_on
      FROM loans l
      JOIN loan_applications la ON la.id = l.application_id
      JOIN loan_products lp ON lp.id = la.loan_product_id
    ),
    due AS (
      SELECT to_char(sl.due_date, 'YYYY-MM') AS month, live.product, sum(sl.interest_due) AS expected
      FROM schedule_lines sl
      JOIN loan_schedules s ON s.id = sl.schedule_id AND s.is_active
      JOIN live ON live.id = s.loan_id
      WHERE live.status IN ('active', 'settled')
        AND (live.closed_on IS NULL OR sl.due_date <= live.closed_on)
        AND sl.due_date >= ${start}::date AND sl.due_date < ${endExclusive}::date
      GROUP BY 1, 2
    ),
    paid AS (
      SELECT to_char(r.value_date, 'YYYY-MM') AS month, live.product,
             sum(COALESCE((r.allocation->>'interest')::numeric, 0)) AS collected
      FROM repayments r
      JOIN live ON live.id = r.loan_id
      WHERE r.value_date >= ${start}::date AND r.value_date < ${endExclusive}::date
      GROUP BY 1, 2
    )
    SELECT COALESCE(due.month, paid.month) AS month,
           COALESCE(due.product, paid.product) AS product,
           COALESCE(due.expected, 0) AS expected,
           COALESCE(paid.collected, 0) AS collected
    FROM due FULL JOIN paid ON paid.month = due.month AND paid.product = due.product`;

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const byMonth = new Map<string, { expected: number; collected: number }>();
  const byProduct = new Map<string, { expected: number; collected: number }>();
  for (const r of rows) {
    const e = Number(r.expected), c = Number(r.collected);
    const m = byMonth.get(r.month as string) ?? { expected: 0, collected: 0 };
    m.expected += e; m.collected += c; byMonth.set(r.month as string, m);
    const p = byProduct.get(r.product as string) ?? { expected: 0, collected: 0 };
    p.expected += e; p.collected += c; byProduct.set(r.product as string, p);
  }

  const months: InterestMonth[] = [];
  for (let m = from; m <= to; m = addMonth(m, 1)) {
    const v = byMonth.get(m) ?? { expected: 0, collected: 0 };
    months.push({ month: m, label: monthLabel(m), expected: r2(v.expected), collected: r2(v.collected), current: m === today, future: m > today });
  }
  const sum = (xs: InterestMonth[], k: "expected" | "collected") => r2(xs.reduce((s, x) => s + x[k], 0));
  return {
    from, to, months,
    byProduct: [...byProduct.entries()]
      .map(([product, v]) => ({ product, expected: r2(v.expected), collected: r2(v.collected) }))
      .sort((a, b) => b.expected - a.expected || b.collected - a.collected),
    totals: {
      expected: sum(months, "expected"),
      collected: sum(months, "collected"),
      expectedToDate: sum(months.filter((m) => !m.future && !m.current), "expected"),
      collectedToDate: sum(months.filter((m) => !m.future && !m.current), "collected"),
      expectedAhead: sum(months.filter((m) => m.future || m.current), "expected"),
    },
  };
}

export interface DepartmentUptake { department: string; headcount: number; borrowers: number; outstanding: number }
export interface PeopleOverview {
  /** Active employees. */
  headcount: number;
  /** Active employees with at least one running loan. */
  borrowers: number;
  byDepartment: DepartmentUptake[];
  /** People no longer employed (exited or suspended) who still have a running loan. */
  leaversWithBalance: { people: number; outstanding: number };
}

/** The people side of the programme, for the CEO's overview: how many staff borrow, by
 *  department, and balances left behind by people who have gone. Outstanding comes from
 *  loan_balances (the one definition). RLS scopes every table to the caller's tenant. */
export async function peopleOverview(tx: Tx): Promise<PeopleOverview> {
  const [rows, [leavers]] = await Promise.all([
    tx`
      WITH running AS (
        SELECT la.employee_id, sum(COALESCE(lb.outstanding, l.principal)) AS outstanding
        FROM loans l
        JOIN loan_applications la ON la.id = l.application_id
        LEFT JOIN loan_balances lb ON lb.loan_id = l.id
        WHERE l.status = 'active'
        GROUP BY la.employee_id
      )
      SELECT COALESCE(NULLIF(e.department, ''), 'Unassigned') AS department,
             count(*)::int AS headcount,
             count(r.employee_id)::int AS borrowers,
             COALESCE(sum(r.outstanding), 0) AS outstanding
      FROM employees e
      LEFT JOIN running r ON r.employee_id = e.id
      WHERE e.status = 'active'
      GROUP BY 1
      ORDER BY count(r.employee_id) DESC, count(*) DESC`,
    tx`
      SELECT count(DISTINCT e.id)::int AS people, COALESCE(sum(COALESCE(lb.outstanding, l.principal)), 0) AS outstanding
      FROM loans l
      JOIN loan_applications la ON la.id = l.application_id
      JOIN employees e ON e.id = la.employee_id
      LEFT JOIN loan_balances lb ON lb.loan_id = l.id
      WHERE l.status = 'active' AND e.status <> 'active'`,
  ]);
  const byDepartment = rows.map((r) => ({
    department: r.department as string,
    headcount: Number(r.headcount),
    borrowers: Number(r.borrowers),
    outstanding: Number(r.outstanding),
  }));
  return {
    headcount: byDepartment.reduce((s, d) => s + d.headcount, 0),
    borrowers: byDepartment.reduce((s, d) => s + d.borrowers, 0),
    byDepartment,
    leaversWithBalance: { people: Number(leavers.people), outstanding: Number(leavers.outstanding) },
  };
}
