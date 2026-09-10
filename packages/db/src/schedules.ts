// packages/db/src/schedules.ts
// Bridge between the pure amortization engine and the database.
import { generateSchedule, ENGINE_VERSION } from "@wola/engine";
import type { Tx } from "./client";

export interface PersistScheduleArgs {
  tenantId: string;
  loanId: string;
  principal: number;
  annualRate: number;
  tenorMonths: number;
  paymentsPerYear?: number;
  startDate: Date;
  decimals?: number | null;
}

export async function persistSchedule(tx: Tx, args: PersistScheduleArgs) {
  const schedule = generateSchedule({
    principal: args.principal,
    annualRate: args.annualRate,
    tenorMonths: args.tenorMonths,
    paymentsPerYear: args.paymentsPerYear ?? 12,
    startDate: args.startDate,
    decimals: args.decimals ?? 0,
  });

  const [prev] = await tx`
    SELECT COALESCE(MAX(version), 0) AS v FROM loan_schedules
    WHERE loan_id = ${args.loanId}`;
  const version = Number(prev.v) + 1;

  await tx`UPDATE loan_schedules SET is_active = false
    WHERE loan_id = ${args.loanId} AND is_active = true`;

  const [sched] = await tx`
    INSERT INTO loan_schedules (tenant_id, loan_id, version, engine_version, is_active)
    VALUES (${args.tenantId}, ${args.loanId}, ${version}, ${ENGINE_VERSION}, true)
    RETURNING id`;

  for (const line of schedule.lines) {
    await tx`
      INSERT INTO schedule_lines
        (tenant_id, schedule_id, period_no, due_date, opening_balance,
         principal_due, interest_due, instalment, closing_balance)
      VALUES
        (${args.tenantId}, ${sched.id}, ${line.period}, ${line.dueDate},
         ${line.openingBalance}, ${line.principal}, ${line.interest},
         ${line.instalment}, ${line.closingBalance})`;
  }

  return { scheduleId: sched.id as string, version, lineCount: schedule.lines.length };
}

/** Persist an ALREADY-COMPUTED schedule (e.g. the output of applyEarlyPayment
 *  after a lump-sum repayment) as a new active version. Unlike persistSchedule,
 *  this does not regenerate — it writes the exact lines given. Keeps prior
 *  versions for audit (marks them inactive). */
export async function persistScheduleObject(
  tx: Tx,
  args: { tenantId: string; loanId: string; lines: Array<{
    period: number; dueDate: string | Date; openingBalance: number;
    principal: number; interest: number; instalment: number; closingBalance: number;
  }> },
) {
  const [prev] = await tx`
    SELECT COALESCE(MAX(version), 0) AS v FROM loan_schedules
    WHERE loan_id = ${args.loanId}`;
  const version = Number(prev.v) + 1;

  await tx`UPDATE loan_schedules SET is_active = false
    WHERE loan_id = ${args.loanId} AND is_active = true`;

  const [sched] = await tx`
    INSERT INTO loan_schedules (tenant_id, loan_id, version, engine_version, is_active)
    VALUES (${args.tenantId}, ${args.loanId}, ${version}, ${ENGINE_VERSION}, true)
    RETURNING id`;

  for (const line of args.lines) {
    await tx`
      INSERT INTO schedule_lines
        (tenant_id, schedule_id, period_no, due_date, opening_balance,
         principal_due, interest_due, instalment, closing_balance)
      VALUES
        (${args.tenantId}, ${sched.id}, ${line.period}, ${line.dueDate},
         ${line.openingBalance}, ${line.principal}, ${line.interest},
         ${line.instalment}, ${line.closingBalance})`;
  }

  return { scheduleId: sched.id as string, version, lineCount: args.lines.length };
}
