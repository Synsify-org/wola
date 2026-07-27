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

  const [loan] = await tx`
    INSERT INTO loans
      (tenant_id, application_id, principal, annual_rate, rate_mode,
       start_date, tenor_months, status)
    VALUES
      (${args.tenantId}, ${args.applicationId}, ${appn.amount},
       ${args.annualRate}, ${args.rateMode ?? "fixed"},
       ${args.startDate}, ${appn.tenor_months}, 'active')
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
