// packages/db/src/employee-financials.ts
// Assembles what the eligibility engine needs about a person. Note there are
// no product-specific flags here: which products clash is CONFIGURATION
// (product_exclusions), not a property of the employee.
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
  internalRecoveries: number;
  activeProductIds: string[];
}

export async function getEmployeeProfile(
  tx: Tx,
  userId: string,
): Promise<EmployeeProfile | null> {
  const [emp] = await tx`
    SELECT id, employee_no, full_name, title, department, department_head,
           gross_salary, net_salary, is_post_probation, on_final_warning
    FROM employees WHERE user_id = ${userId} AND status = 'active'`;
  if (!emp) return null;

  // Active loans: their monthly instalment is an internal recovery, and the
  // product they are against decides what the employee may now take out.
  const loans = await tx`
    SELECT la.loan_product_id,
           (SELECT sl.instalment FROM schedule_lines sl
             JOIN loan_schedules s ON s.id = sl.schedule_id
            WHERE s.loan_id = l.id AND s.is_active
            ORDER BY sl.period_no LIMIT 1) AS monthly
    FROM loans l
    JOIN loan_applications la ON la.id = l.application_id
    WHERE la.employee_id = ${emp.id} AND l.status = 'active'`;

  let internalRecoveries = 0;
  const activeProductIds: string[] = [];
  for (const l of loans) {
    internalRecoveries += Number(l.monthly ?? 0);
    activeProductIds.push(l.loan_product_id as string);
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
    activeProductIds,
  };
}
