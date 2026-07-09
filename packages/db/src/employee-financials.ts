// packages/db/src/employee-financials.ts
// Assembles the EmployeeFinancials shape the eligibility engine needs,
// from the employee row + their active loans. Runs inside a tenantTx.
import type { Tx } from "./client";

export interface EmployeeProfile {
  employeeId: string;
  employeeNo: string;
  fullName: string;
  title: string | null;
  department: string | null;
  departmentHead: string | null;
  grossSalary: number;
  netSalary: number;
  isPostProbation: boolean;
  onFinalWarning: boolean;
  internalRecoveries: number;      // computed from active loans
  hasActiveDevelopmentLoan: boolean;
  hasActiveCarLoan: boolean;
}

/** Load the logged-in user's employee profile + computed loan state.
 *  Returns null if the user has no employee record in this tenant. */
export async function getEmployeeProfile(tx: Tx, userId: string): Promise<EmployeeProfile | null> {
  const [emp] = await tx`
    SELECT id, employee_no, full_name, title, department, department_head,
           gross_salary, net_salary, is_post_probation, on_final_warning
    FROM employees WHERE user_id = ${userId} AND status = 'active'`;
  if (!emp) return null;

  // Active loans for this employee → internal recoveries = sum of monthly
  // instalments from each active loan's active schedule (first line's instalment
  // is the level payment). Also detect concurrency flags.
  const loans = await tx`
    SELECT l.id, l.status,
           lp.kind AS product_kind,
           (SELECT sl.instalment FROM schedule_lines sl
            JOIN loan_schedules s ON s.id = sl.schedule_id
            WHERE s.loan_id = l.id AND s.is_active
            ORDER BY sl.period_no LIMIT 1) AS monthly
    FROM loans l
    JOIN loan_applications la ON la.id = l.application_id
    JOIN loan_products lp ON lp.id = la.loan_product_id
    WHERE la.employee_id = ${emp.id} AND l.status = 'active'`;

  let internalRecoveries = 0;
  let hasActiveDevelopmentLoan = false;
  let hasActiveCarLoan = false;
  for (const l of loans) {
    internalRecoveries += Number(l.monthly ?? 0);
    if (l.product_kind === "term") hasActiveDevelopmentLoan = true;
    if (l.product_kind === "asset") hasActiveCarLoan = true;
  }

  return {
    employeeId: emp.id as string,
    employeeNo: emp.employee_no as string,
    fullName: emp.full_name as string,
    title: emp.title as string | null,
    department: emp.department as string | null,
    departmentHead: emp.department_head as string | null,
    grossSalary: Number(emp.gross_salary),
    netSalary: Number(emp.net_salary),
    isPostProbation: emp.is_post_probation as boolean,
    onFinalWarning: emp.on_final_warning as boolean,
    internalRecoveries,
    hasActiveDevelopmentLoan,
    hasActiveCarLoan,
  };
}