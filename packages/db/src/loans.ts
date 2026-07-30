// packages/db/src/loans.ts
// Creating a loan is a SIDE EFFECT OF FINAL APPROVAL, never a separate act.
//
// The schema forces this: loan_schedules.loan_id is NOT NULL, so no schedule
// can exist before its loan. stageCanGenerateSchedule() in @wola/engine
// described a CFO-generates-schedule flow the database cannot express — it is
// dead. The CEO sees a COMPUTED preview on the application page (the engine
// runs, nothing persists); persistence happens once, at approval.
import { persistSchedule } from "./schedules";
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