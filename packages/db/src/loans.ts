// packages/db/src/loans.ts
// Creating a loan is a SIDE EFFECT OF FINAL APPROVAL, never a separate act.
//
// The schema forces this: loan_schedules.loan_id is NOT NULL, so no schedule
// can exist before its loan. stageCanGenerateSchedule() in @wola/engine
// described a CFO-generates-schedule flow the database cannot express — it is
// dead. The CEO sees a COMPUTED preview on the application page (the engine
// runs, nothing persists); persistence happens once, at approval.
import { persistSchedule, persistScheduleObject } from "./schedules";
import { applyEarlyPayment, getCurrencyDecimals, ENGINE_VERSION, type Schedule } from "@wola/engine";
import type { Tx } from "./client";

export interface CreateLoanArgs {
  tenantId: string;
  applicationId: string;
  startDate: Date;      // the intended DISBURSEMENT date. A human owns this.
  annualRate: number;
  rateMode?: "fixed" | "index_plus_margin";
}

/** Materialise an approved application into a loan + its first schedule. */
export async function createLoanFromApplication(
  tx: Tx, args: CreateLoanArgs,
): Promise<{ loanId: string; scheduleId: string; lineCount: number }> {
  const [appn] = await tx`
    SELECT amount, tenor_months, status FROM loan_applications
    WHERE tenant_id = ${args.tenantId} AND id = ${args.applicationId}`;
  if (!appn) throw new Error("Application not found.");
  if (appn.status !== "approved") {
    throw new Error(`Cannot create a loan from a ${appn.status} application.`);
  }

  // One loan per application, always. A retry must not create a second.
  const [existing] = await tx`
    SELECT id FROM loans
    WHERE tenant_id = ${args.tenantId} AND application_id = ${args.applicationId}`;
  if (existing) throw new Error("This application already has a loan.");

  // A newly approved loan is NOT yet disbursed. It starts
  // 'pending_disbursement'; finance disburses it separately (disburseLoan),
  // which flips it to 'active' and records the money movement. This is what
  // migration 0009 intended — approval ≠ disbursement.
  const [loan] = await tx`
    INSERT INTO loans
      (tenant_id, application_id, principal, annual_rate, rate_mode,
       start_date, tenor_months, status)
    VALUES
      (${args.tenantId}, ${args.applicationId}, ${appn.amount},
       ${args.annualRate}, ${args.rateMode ?? "fixed"},
       ${args.startDate}, ${appn.tenor_months}, 'pending_disbursement')
    RETURNING id`;

  const [tenant] = await tx`SELECT currency FROM tenants WHERE id = ${args.tenantId}`;
  const sched = await persistSchedule(tx, {
    tenantId: args.tenantId,
    loanId: loan.id as string,
    principal: Number(appn.amount),
    annualRate: args.annualRate,
    tenorMonths: appn.tenor_months as number,
    startDate: args.startDate,
    decimals: getCurrencyDecimals(tenant.currency as string),
  });

  return { loanId: loan.id as string, ...sched };
}

export interface DisburseArgs {
  tenantId: string;
  loanId: string;
  method?: "to_employee" | "to_vendor";
  reference?: string | null;
  disbursedAt?: Date;      // actual pay-out date; defaults to now
  postedBy?: string | null; // user id of the finance actor
}

/** Record the actual pay-out of a loan and activate it. This is the money
 *  movement 0009 separated from approval: a loan is only 'active' — counted as
 *  real exposure — once finance disburses it. Guards:
 *   - the loan must be 'pending_disbursement' (can't disburse twice, can't
 *     disburse a settled/written-off loan)
 *   - writes ONE disbursements row for the full principal
 *  Atomic: status flip + disbursements insert happen in the same tx. */
export async function disburseLoan(
  tx: Tx, args: DisburseArgs,
): Promise<{ loanId: string; amount: number; disbursedAt: string }> {
  // FOR UPDATE: a concurrent disbursement of the same loan blocks here until
  // this transaction commits, then re-reads status 'active' and is refused.
  // Without the lock both read 'pending_disbursement' and both pay out.
  const [loan] = await tx`
    SELECT id, principal, status FROM loans
    WHERE tenant_id = ${args.tenantId} AND id = ${args.loanId}
    FOR UPDATE`;
  if (!loan) throw new Error("Loan not found.");
  if (loan.status !== "pending_disbursement") {
    throw new Error(
      `Only a pending loan can be disbursed; this one is '${loan.status}'.`,
    );
  }

  const when = args.disbursedAt ?? new Date();

  await tx`
    INSERT INTO disbursements
      (tenant_id, loan_id, method, amount, reference, disbursed_at)
    VALUES
      (${args.tenantId}, ${args.loanId}, ${args.method ?? "to_employee"},
       ${loan.principal}, ${args.reference ?? null}, ${when})`;

  await tx`
    UPDATE loans SET status = 'active'
    WHERE tenant_id = ${args.tenantId} AND id = ${args.loanId}`;

  return {
    loanId: args.loanId,
    amount: Number(loan.principal),
    disbursedAt: when.toISOString(),
  };
}

// ---- Repayment recording (events, not schedule mutation) -------------------
// Payments are an immutable ledger: we append a `repayments` row and DERIVE
// state from it. The schedule stays a pure projection. "Outstanding" = original
// principal minus principal repaid to date. When principal is fully repaid the
// loan flips active -> settled. This keeps an auditable money-in trail (matches
// the RLS/audit posture that is Wola's differentiator) and avoids the
// replacement-row mess that mutating the schedule forces.

export interface RepaymentArgs {
  tenantId: string;
  loanId: string;
  amount: number;
  source?: "payroll" | "manual" | "early";
  valueDate?: Date;          // when the money was deducted; defaults to today
  postedBy?: string | null;
}

/** Principal repaid to date + true outstanding for one loan. Derived by summing
 *  the principal portion of every repayment's allocation. */
export async function loanOutstanding(
  tx: Tx, tenantId: string, loanId: string,
): Promise<{ principal: number; principalRepaid: number; outstanding: number }> {
  const [loan] = await tx`
    SELECT principal FROM loans
    WHERE tenant_id = ${tenantId} AND id = ${loanId}`;
  if (!loan) throw new Error("Loan not found.");
  const principal = Number(loan.principal);

  const [agg] = await tx`
    SELECT COALESCE(sum((allocation->>'principal')::numeric), 0) AS repaid
    FROM repayments
    WHERE tenant_id = ${tenantId} AND loan_id = ${loanId}`;
  const principalRepaid = Number(agg?.repaid ?? 0);

  return {
    principal,
    principalRepaid,
    outstanding: Math.max(0, principal - principalRepaid),
  };
}

// ---- Where the ledger stands against the schedule --------------------------
// ONE definition of "the current instalment", shared by recordRepayment (what
// a payment is allocated to) and repaymentPosition (what the app tells people
// is due next), so the two can never disagree.

const EPS = 0.001;
const round2 = (n: number) => Math.round(n * 100) / 100;

type SchedLine = {
  period_no: number; due_date: string | Date; opening_balance: string; principal_due: string;
  interest_due: string; instalment: string; closing_balance: string;
  due_iso: string; overdue: boolean;
};

/** The active schedule's lines plus the interest already allocated. */
async function loadLedgerState(tx: Tx, tenantId: string, loanId: string) {
  const [paid] = await tx`
    SELECT COALESCE(sum((allocation->>'interest')::numeric), 0) AS interest
    FROM repayments
    WHERE tenant_id = ${tenantId} AND loan_id = ${loanId}`;
  const lines = (await tx`
    SELECT sl.period_no, sl.due_date, sl.opening_balance, sl.principal_due,
           sl.interest_due, sl.instalment, sl.closing_balance,
           to_char(sl.due_date, 'YYYY-MM-DD') AS due_iso,
           sl.due_date < CURRENT_DATE AS overdue
    FROM schedule_lines sl
    JOIN loan_schedules s ON s.id = sl.schedule_id
    WHERE s.loan_id = ${loanId} AND s.is_active = true
    ORDER BY sl.period_no ASC`) as unknown as SchedLine[];
  return { lines, interestPaid: Number(paid?.interest ?? 0) };
}

/** The current line is the first one whose closing balance is still below the
 *  true outstanding, or whose interest isn't fully paid. interestOwed =
 *  scheduled interest through that line − interest already allocated. */
function locateCurrentLine(lines: SchedLine[], outstanding: number, interestPaid: number) {
  let cumInterest = 0;
  for (const l of lines) {
    cumInterest += Number(l.interest_due);
    if (Number(l.closing_balance) < outstanding - EPS || cumInterest > interestPaid + EPS) {
      return { line: l, interestOwed: round2(Math.max(0, cumInterest - interestPaid)) };
    }
  }
  return { line: null, interestOwed: 0 };
}

export interface RepaymentPosition {
  status: string;
  principal: number;
  principalRepaid: number;
  outstanding: number;
  /** Interest + outstanding principal: the most a payment may be. */
  payoff: number;
  /** What's due next, from the LEDGER — null when nothing is owed (settled,
   *  written off, or not yet disbursed). */
  next: { amount: number; dueDate: string; periodNo: number; overdue: boolean } | null;
}

/** A loan's repayment position, derived from the ledger. Use this for any
 *  "next deduction" shown to people: dates alone can't tell whether a loan
 *  was paid early, in part, or in full.
 *
 *  next.amount is what clears the current instalment — its unpaid interest
 *  plus the principal still standing above its scheduled closing balance. A
 *  fresh instalment is exactly its scheduled amount; a part-paid one is the
 *  remainder; the final one is the full payoff (often less than the level
 *  instalment). */
export async function repaymentPosition(tx: Tx, tenantId: string, loanId: string): Promise<RepaymentPosition> {
  const [loan] = await tx`SELECT status FROM loans WHERE tenant_id = ${tenantId} AND id = ${loanId}`;
  if (!loan) throw new Error("Loan not found.");
  const o = await loanOutstanding(tx, tenantId, loanId);
  const status = loan.status as string;
  const base = { status, principal: o.principal, principalRepaid: o.principalRepaid, outstanding: o.outstanding };

  if (status !== "active" || o.outstanding <= EPS) return { ...base, payoff: 0, next: null };

  const { lines, interestPaid } = await loadLedgerState(tx, tenantId, loanId);
  const { line, interestOwed } = locateCurrentLine(lines, o.outstanding, interestPaid);
  const payoff = round2(interestOwed + o.outstanding);
  if (!line) {
    // Outstanding principal but no schedule line left to carry it (shouldn't
    // happen on a well-formed schedule): the payoff is all that's due.
    return { ...base, payoff, next: null };
  }

  const principalOnLine = Math.min(o.outstanding, Math.max(0, o.outstanding - Number(line.closing_balance)));
  const amount = Math.min(payoff, round2(principalOnLine + interestOwed));
  return {
    ...base,
    payoff,
    next: {
      amount,
      dueDate: line.due_iso,
      periodNo: Number(line.period_no),
      overdue: Boolean(line.overdue),
    },
  };
}

/** Record a repayment against an ACTIVE loan.
 *
 *  Allocation (interest first, then principal) is driven by the LEDGER, not by
 *  how many instalments' worth of cash has come in:
 *   - the "current" schedule line is the first one whose closing balance is
 *     still below the true outstanding, or whose interest isn't fully paid;
 *   - interest owed = scheduled interest through that line − interest already
 *     allocated. So a split instalment pays its interest ONCE, not once per
 *     payment, and the loan still settles on schedule.
 *
 *  Guards: loan must be active (row-locked, so concurrent repayments
 *  serialise); amount must be > 0 and no more than the full payoff (interest
 *  owed + outstanding principal) — an excess would otherwise vanish from the
 *  ledger unallocated. If the payment clears the loan it flips to 'settled'. */
export async function recordRepayment(
  tx: Tx, args: RepaymentArgs,
): Promise<{ repaymentId: string; outstanding: number; settled: boolean; reamortized: boolean }> {
  if (!(args.amount > 0)) throw new Error("Repayment amount must be positive.");

  // FOR UPDATE serialises concurrent repayments on one loan: the second waits,
  // then sees the first's allocation (or 'settled') instead of the same stale
  // outstanding — two payoffs can't both allocate the full principal.
  const [loan] = await tx`
    SELECT principal, status, annual_rate, tenor_months, start_date FROM loans
    WHERE tenant_id = ${args.tenantId} AND id = ${args.loanId}
    FOR UPDATE`;
  if (!loan) throw new Error("Loan not found.");
  if (loan.status !== "active") {
    throw new Error(`Only an active loan can take a repayment; this one is '${loan.status}'.`);
  }

  const before = await loanOutstanding(tx, args.tenantId, args.loanId);
  if (before.outstanding <= 0) {
    throw new Error("This loan is already fully repaid.");
  }

  const { lines, interestPaid } = await loadLedgerState(tx, args.tenantId, args.loanId);
  const { line, interestOwed } = locateCurrentLine(lines, before.outstanding, interestPaid);
  const payoff = round2(interestOwed + before.outstanding);
  if (args.amount > payoff + EPS) {
    throw new Error(
      `A payment of ${args.amount} exceeds the full payoff of ${payoff} (interest owed + outstanding principal).`,
    );
  }

  const interestPortion = Math.min(interestOwed, args.amount);
  const principalPortion = round2(args.amount - interestPortion);
  const allocation = { interest: interestPortion, principal: principalPortion };

  const [rep] = await tx`
    INSERT INTO repayments
      (tenant_id, loan_id, source, amount, value_date, allocation, posted_by)
    VALUES
      (${args.tenantId}, ${args.loanId}, ${args.source ?? "payroll"},
       ${args.amount}, ${args.valueDate ?? new Date()},
       ${tx.json(allocation)}, ${args.postedBy ?? null})
    RETURNING id`;

  const after = await loanOutstanding(tx, args.tenantId, args.loanId);
  const settled = after.outstanding <= EPS;
  if (settled) {
    await tx`UPDATE loans SET status = 'settled'
             WHERE tenant_id = ${args.tenantId} AND id = ${args.loanId}`;
  }

  // ---- Lump-sum re-amortization -------------------------------------------
  // A payment materially LARGER than the scheduled instalment puts the
  // borrower ahead, so the fixed schedule no longer reflects reality. Rebuild
  // the remainder, keeping the same instalment (loan finishes SOONER) — the
  // standard treatment for staff loans.
  //
  // Built from the CURRENT active schedule (not regenerated from the original
  // terms, which would erase any earlier lump sum), and pinned to the LEDGER:
  // the extra is whatever takes the current line's scheduled closing balance
  // down to the true outstanding. Passing the whole principal portion instead
  // double-counted the line's own scheduled principal.
  const scheduledInstalment = line ? Number(line.instalment) : 0;
  const isLumpSum =
    !settled && line !== null &&
    scheduledInstalment > 0 &&
    args.amount > scheduledInstalment * 1.5; // clearly more than one instalment

  let reamortized = false;
  const extra = line ? round2(Number(line.closing_balance) - after.outstanding) : 0;
  if (isLumpSum && extra > EPS) {
    const [tenant] = await tx`SELECT currency FROM tenants WHERE id = ${args.tenantId}`;
    const input = {
      principal: Number(loan.principal),
      // annual_rate is stored as a FRACTION (0.16 = 16%) — see resolveRate()
      // in approvals.ts. Do NOT divide by 100 here.
      annualRate: Number(loan.annual_rate),
      tenorMonths: Number(loan.tenor_months),
      paymentsPerYear: 12,
      startDate: new Date(loan.start_date as string),
      decimals: getCurrencyDecimals(tenant.currency as string),
    };
    let cum = 0;
    const current: Schedule = {
      instalment: scheduledInstalment,
      engineVersion: ENGINE_VERSION,
      totalInterest: 0,
      lines: lines.map((l) => {
        cum += Number(l.interest_due);
        return {
          period: Number(l.period_no), dueDate: new Date(l.due_date),
          openingBalance: Number(l.opening_balance), interest: Number(l.interest_due),
          principal: Number(l.principal_due), instalment: Number(l.instalment),
          closingBalance: Number(l.closing_balance), cumulativeInterest: cum,
        };
      }),
    };
    current.totalInterest = cum;

    const recalculated = applyEarlyPayment(current, input, Number(line!.period_no), extra);
    await persistScheduleObject(tx, {
      tenantId: args.tenantId,
      loanId: args.loanId,
      lines: recalculated.lines.map((l) => ({
        period: l.period, dueDate: l.dueDate, openingBalance: l.openingBalance,
        principal: l.principal, interest: l.interest, instalment: l.instalment,
        closingBalance: l.closingBalance,
      })),
    });
    reamortized = true;
  }

  return { repaymentId: rep.id as string, outstanding: after.outstanding, settled, reamortized };
}
