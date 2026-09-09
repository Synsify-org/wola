// packages/db/src/hr-register.ts
// Register health for the HR hero (architecture doc §6.2): HR owns the
// employee data eligibility runs on, so its dashboard's centrepiece is a
// data-quality panel, not a financial one — headcount/probation/final-warning
// counts, and — first — anything that would BLOCK eligibility.
//
// The doc also names "stale probation status" as a blocking signal. There is
// no hire-date/probation-start column on `employees` to compute staleness
// from, so it's deliberately left out rather than faked with a heuristic that
// would misreport — see TASKS.md.
import type { Tx } from "./client";

export interface RegisterHealth {
  headcount: number;
  onProbation: number;
  onFinalWarning: number;
  missingDeptHead: number;
  missingSalary: number;
}

export async function registerHealth(tx: Tx, tenantId: string): Promise<RegisterHealth> {
  const [row] = await tx`
    SELECT
      count(*)::int AS headcount,
      count(*) FILTER (WHERE NOT is_post_probation)::int AS on_probation,
      count(*) FILTER (WHERE on_final_warning)::int AS on_final_warning,
      count(*) FILTER (WHERE department_head_id IS NULL)::int AS missing_dept_head,
      -- gross_salary is NOT NULL (schema-enforced); 0 is the only signal
      -- available that a real figure was never entered.
      count(*) FILTER (WHERE gross_salary = 0)::int AS missing_salary
    FROM employees
    WHERE tenant_id = ${tenantId} AND status = 'active'`;

  return {
    headcount: Number(row.headcount),
    onProbation: Number(row.on_probation),
    onFinalWarning: Number(row.on_final_warning),
    missingDeptHead: Number(row.missing_dept_head),
    missingSalary: Number(row.missing_salary),
  };
}
