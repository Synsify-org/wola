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

export interface RegisterPerson {
  id: string;
  name: string;
  employeeNo: string;
}

export interface RegisterHealth {
  headcount: number;
  onProbation: number;
  onFinalWarning: number;
  missingDeptHead: number;
  missingSalary: number;
  /** WHO is behind the two counts above, so the panel can name them and the
   *  directory can show exactly those people — not just "4 staff". */
  missingDeptHeadPeople: RegisterPerson[];
  missingSalaryPeople: RegisterPerson[];
}

/** Roles at the top of the chain of command. They have nobody above them to
 *  be their department head, and their applications route through a pipeline
 *  with no dept-head stage — flagging them as "missing a department head"
 *  raised a warning that could never be cleared. */
const TOP_OF_CHAIN_ROLES = ["ceo", "group_ceo", "md"];

export async function registerHealth(tx: Tx, tenantId: string): Promise<RegisterHealth> {
  const rows = await tx`
    SELECT e.id, e.full_name, e.employee_no,
           NOT e.is_post_probation AS on_probation,
           e.on_final_warning,
           (e.department_head_id IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM memberships m
               WHERE m.tenant_id = e.tenant_id AND m.user_id = e.user_id
                 AND m.role = ANY(${TOP_OF_CHAIN_ROLES}))) AS no_head,
           -- gross_salary is NOT NULL (schema-enforced); 0 is the only signal
           -- available that a real figure was never entered.
           (e.gross_salary = 0) AS no_salary
    FROM employees e
    WHERE e.tenant_id = ${tenantId} AND e.status = 'active'
    ORDER BY e.full_name`;

  const person = (r: (typeof rows)[number]): RegisterPerson => ({
    id: r.id as string,
    name: r.full_name as string,
    employeeNo: r.employee_no as string,
  });
  const missingDeptHeadPeople = rows.filter((r) => r.no_head).map(person);
  const missingSalaryPeople = rows.filter((r) => r.no_salary).map(person);

  return {
    headcount: rows.length,
    onProbation: rows.filter((r) => r.on_probation).length,
    onFinalWarning: rows.filter((r) => r.on_final_warning).length,
    missingDeptHead: missingDeptHeadPeople.length,
    missingSalary: missingSalaryPeople.length,
    missingDeptHeadPeople,
    missingSalaryPeople,
  };
}
