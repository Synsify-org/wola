// packages/db/src/loans.ts
// Creating a loan is a SIDE EFFECT OF FINAL APPROVAL, never a separate act.
//
// The schema forces this: loan_schedules.loan_id is NOT NULL, so no schedule
// can exist before its loan. stageCanGenerateSchedule() in @wola/engine
// described a CFO-generates-schedule flow the database cannot express — it is
// dead. The CEO sees a COMPUTED preview on the application page (the engine
// runs, nothing persists); persistence happens once, at approval.
import { persistSchedule, persistScheduleObject } from "./schedules";
import { generateSchedule, applyEarlyPayment } from "@wola/engine";
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

  const sched = await persistSchedule(tx, {
    tenantId: args.tenantId,
    loanId: loan.id as string,
    principal: Number(appn.amount),
    annualRate: args.annualRate,
    tenorMonths: appn.tenor_months as number,
    startDate: args.startDate,
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
  const [loan] = await tx`
    SELECT id, principal, status FROM loans
    WHERE tenant_id = ${args.tenantId} AND id = ${args.loanId}`;
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

/** Record a repayment against an ACTIVE loan. The interest/principal split is
 *  taken from the next unpaid schedule line (on-schedule path). If the payment
 *  clears the loan, it flips to 'settled'. Guards: loan must be active; amount
 *  must be > 0 and not exceed the outstanding balance by more than one
 *  instalment (guards against fat-finger double-deductions). */
export async function recordRepayment(
  tx: Tx, args: RepaymentArgs,
): Promise<{ repaymentId: string; outstanding: number; settled: boolean; reamortized: boolean }> {
  if (!(args.amount > 0)) throw new Error("Repayment amount must be positive.");

  const [loan] = await tx`
    SELECT principal, status FROM loans
    WHERE tenant_id = ${args.tenantId} AND id = ${args.loanId}`;
  if (!loan) throw new Error("Loan not found.");
  if (loan.status !== "active") {
    throw new Error(`Only an active loan can take a repayment; this one is '${loan.status}'.`);
  }

  const before = await loanOutstanding(tx, args.tenantId, args.loanId);
  if (before.outstanding <= 0) {
    throw new Error("This loan is already fully repaid.");
  }

  // Determine the interest/principal split. Find the next unpaid schedule line:
  // walk periods until cumulative instalment exceeds what's already been paid.
  const paidAgg = await tx`
    SELECT COALESCE(sum(amount), 0) AS paid
    FROM repayments
    WHERE tenant_id = ${args.tenantId} AND loan_id = ${args.loanId}`;
  const paidToDate = Number(paidAgg[0]?.paid ?? 0);

  const lines = await tx`
    SELECT sl.period_no, sl.instalment, sl.principal_due, sl.interest_due
    FROM schedule_lines sl
    JOIN loan_schedules s ON s.id = sl.schedule_id
    WHERE s.loan_id = ${args.loanId} AND s.is_active = true
    ORDER BY sl.period_no ASC`;

  // The line this payment lands on = first line whose cumulative instalment
  // total crosses paidToDate.
  type SchedLine = { period_no: number; instalment: string; principal_due: string; interest_due: string };
  let cumulative = 0;
  let line: SchedLine | null = null;
  for (const l of lines as unknown as SchedLine[]) {
    cumulative += Number(l.instalment);
    if (cumulative > paidToDate + 0.001) { line = l; break; }
  }

  // Split the payment: interest first (as scheduled), remainder to principal.
  // Capped so we never allocate more principal than remains outstanding.
  const interestPortion = line ? Math.min(Number(line.interest_due), args.amount) : 0;
  const principalPortion = Math.min(args.amount - interestPortion, before.outstanding);
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
  const settled = after.outstanding <= 0.001;
  if (settled) {
    await tx`UPDATE loans SET status = 'settled'
             WHERE tenant_id = ${args.tenantId} AND id = ${args.loanId}`;
  }

  // ---- Lump-sum re-amortization -------------------------------------------
  // If this payment was materially LARGER than a scheduled instalment (a lump
  // sum / early payment), the fixed schedule no longer reflects reality — the
  // borrower is ahead and the loan will finish early. Regenerate the remaining
  // schedule so future instalments and the payoff date are correct. We keep the
  // same instalment amount (loan finishes SOONER) rather than lowering payments,
  // which is the standard treatment for staff loans.
  //
  // Skipped when the loan just settled (nothing left to re-amortize) or when the
  // payment was a normal on-schedule instalment (no divergence to fix).
  const scheduledInstalment = line ? Number(line.instalment) : 0;
  const isLumpSum =
    !settled &&
    scheduledInstalment > 0 &&
    args.amount > scheduledInstalment * 1.5; // clearly more than one instalment

  let reamortized = false;
  if (isLumpSum) {
    // Rebuild the current schedule object and apply the extra payment beyond the
    // period this payment covers, then persist the recalculated remainder.
    const [meta] = await tx`
      SELECT annual_rate, tenor_months, start_date
      FROM loans WHERE tenant_id = ${args.tenantId} AND id = ${args.loanId}`;
    if (meta) {
      const input = {
        principal: Number(loan.principal),
        // annual_rate is stored as a FRACTION (0.16 = 16%) — see resolveRate()
        // in approvals.ts and the write in applications/[id]/actions.ts. Do
        // NOT divide by 100 here; that was a stale assumption that silently
        // undercharged interest ~100x on any re-amortized schedule.
        annualRate: Number(meta.annual_rate),
        tenorMonths: Number(meta.tenor_months),
        paymentsPerYear: 12,
        startDate: new Date(meta.start_date as string),
        decimals: 0,
      };
      const base = generateSchedule(input);
      // The period the borrower has reached (paid through). extraAmount is the
      // principal paid beyond that period's scheduled closing balance.
      const afterPeriod = line ? Number(line.period_no) : 0;
      const recalculated = applyEarlyPayment(base, input, afterPeriod, principalPortion);
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
  }

  return { repaymentId: rep.id as string, outstanding: after.outstanding, settled, reamortized };
}