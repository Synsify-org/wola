const CAR_TAKEHOME_FACTOR = 0.4;
const CAR_MULTIPLIER = 30;
const CAR_MAX_TENOR = 36;
const DEV_SALARY_MULTIPLE = 3;
const DEV_MAX_TENOR = 36;
const ADVANCE_MAX_TENOR = 3;

export type LoanKind = "advance" | "development" | "car";

export interface EmployeeFinancials {
  grossSalary: number;
  netSalary: number;
  internalRecoveries: number;
  externalRecoveries: number;
  isPostProbation: boolean;
  onFinalWarning: boolean;
  hasActiveDevelopmentLoan: boolean;
  hasActiveCarLoan: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  maxAmount: number;
  reasons: string[];
  interestApplies: boolean;
  maxTenorMonths: number;
}

export function assessEligibility(kind: LoanKind, emp: EmployeeFinancials): EligibilityResult {
  const reasons: string[] = [];
  if (!emp.isPostProbation) reasons.push("Loans are available only after probation.");
  if (emp.onFinalWarning) reasons.push("On a final warning letter — not eligible for any loan.");
  if (reasons.length > 0) return { eligible: false, maxAmount: 0, reasons, interestApplies: false, maxTenorMonths: 0 };

  if (kind === "advance") {
    return { eligible: true, maxAmount: emp.grossSalary, reasons: [], interestApplies: false, maxTenorMonths: ADVANCE_MAX_TENOR };
  }
  if (kind === "development") {
    if (emp.hasActiveCarLoan) reasons.push("Cannot hold a Development Loan alongside a Staff Car Loan.");
    return { eligible: reasons.length === 0, maxAmount: emp.grossSalary * DEV_SALARY_MULTIPLE, reasons, interestApplies: true, maxTenorMonths: DEV_MAX_TENOR };
  }
  if (emp.hasActiveDevelopmentLoan) reasons.push("Cannot hold a Staff Car Loan alongside a Development Loan.");
  const qualifiedIncome = emp.netSalary - emp.internalRecoveries - emp.externalRecoveries;
  const maxAmount = Math.max(0, qualifiedIncome * CAR_TAKEHOME_FACTOR * CAR_MULTIPLIER);
  if (qualifiedIncome <= 0) reasons.push("Take-home after deductions is zero or negative.");
  return { eligible: reasons.length === 0 && maxAmount > 0, maxAmount, reasons, interestApplies: true, maxTenorMonths: CAR_MAX_TENOR };
}