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
import { PROVISIONAL_EMPLOYEE_NO_PREFIX } from "@wola/engine";
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
  /** People whose employee number was made up by Wola, because the organisation's list had none. */
  provisionalNoPeople: RegisterPerson[];
  /** People flagged for a decision when the list was loaded (an unclear line manager, two managers...). */
  reviewPeople: (RegisterPerson & { note: string })[];
  /** Active staff with no login yet and no work email on file, so they cannot be invited. */
  missingEmailPeople: RegisterPerson[];
}

/** Who needs a department head: ordinary staff only.
 *
 *  Anyone who holds a role beyond plain "employee" (executives, the CFO and COO, HR,
 *  administrators, the auditor and the department heads themselves) sits at the top of a
 *  function: there is nobody above them to be their department head, and their applications
 *  route through a pipeline with no department-head stage. Flagging them as "missing a
 *  department head" raised an alarm that could never be cleared (the head of operations, the
 *  CFO and HR all showed up on the HR dashboard). Only a person who holds no such role
 *  genuinely has a gap. */
const NO_HEAD_NEEDED = "employee";

export async function registerHealth(tx: Tx, tenantId: string): Promise<RegisterHealth> {
  const rows = await tx`
    SELECT e.id, e.full_name, e.employee_no,
           NOT e.is_post_probation AS on_probation,
           e.on_final_warning,
           (e.department_head_id IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM memberships m
               WHERE m.tenant_id = e.tenant_id AND m.user_id = e.user_id
                 AND m.role <> ${NO_HEAD_NEEDED})) AS no_head,
           -- gross_salary is NOT NULL (schema-enforced); 0 is the only signal
           -- available that a real figure was never entered.
           (e.gross_salary = 0) AS no_salary,
           (e.employee_no LIKE ${PROVISIONAL_EMPLOYEE_NO_PREFIX + "%"}) AS provisional_no,
           e.review_note,
           (e.user_id IS NULL AND e.work_email IS NULL) AS no_email
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
  const provisionalNoPeople = rows.filter((r) => r.provisional_no).map(person);
  const reviewPeople = rows.filter((r) => r.review_note).map((r) => ({ ...person(r), note: r.review_note as string }));
  const missingEmailPeople = rows.filter((r) => r.no_email).map(person);

  return {
    headcount: rows.length,
    onProbation: rows.filter((r) => r.on_probation).length,
    onFinalWarning: rows.filter((r) => r.on_final_warning).length,
    missingDeptHead: missingDeptHeadPeople.length,
    missingSalary: missingSalaryPeople.length,
    missingDeptHeadPeople,
    missingSalaryPeople,
    provisionalNoPeople,
    reviewPeople,
    missingEmailPeople,
  };
}
