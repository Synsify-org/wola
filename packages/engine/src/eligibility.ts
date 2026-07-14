// packages/engine/src/eligibility.ts
// Eligibility from TENANT CONFIG. The engine knows nothing about advances or
// car loans. It reads a product configuration and computes a cap.
//
// The MUA benefit scheme is ONE configuration. A SACCO with a 4x-net loan over
// 48 months is another. Neither belongs in this file. If a product name ever
// appears here, the design has gone wrong.

export type CapMethod = "salary_multiple" | "takehome_factor";
export type CapBasis = "gross" | "net";

export interface ProductRules {
  productId: string;
  name: string;
  capMethod: CapMethod;
  capBasis: CapBasis;
  capMultiple: number | null;
  takehomeFactor: number | null;
  takehomeMultiplier: number | null;
  maxTenorMonths: number;
  interestApplies: boolean;
  requiresPostProbation: boolean;
  blockedByFinalWarning: boolean;
  requiresExternalDeclaration: boolean;
  excludes: string[];
}

export interface EmployeeFinancials {
  grossSalary: number;
  netSalary: number;
  internalRecoveries: number;
  externalRecoveries: number;
  isPostProbation: boolean;
  onFinalWarning: boolean;
  activeProductIds: string[];
}

export interface EligibilityResult {
  eligible: boolean;
  maxAmount: number;
  reasons: string[];
  interestApplies: boolean;
  maxTenorMonths: number;
  requiresExternalDeclaration: boolean;
}

export function assessEligibility(
  rules: ProductRules,
  emp: EmployeeFinancials,
): EligibilityResult {
  const reasons: string[] = [];

  if (rules.requiresPostProbation && !emp.isPostProbation) {
    reasons.push("Available only after probation.");
  }
  if (rules.blockedByFinalWarning && emp.onFinalWarning) {
    reasons.push("Not available while on a final warning letter.");
  }

  const clash = rules.excludes.find((id) => emp.activeProductIds.includes(id));
  if (clash) {
    reasons.push("Cannot run alongside another loan you already hold.");
  }

  if (reasons.length > 0) {
    return {
      eligible: false,
      maxAmount: 0,
      reasons,
      interestApplies: rules.interestApplies,
      maxTenorMonths: rules.maxTenorMonths,
      requiresExternalDeclaration: rules.requiresExternalDeclaration,
    };
  }

  let maxAmount = 0;

  if (rules.capMethod === "salary_multiple") {
    const basis = rules.capBasis === "net" ? emp.netSalary : emp.grossSalary;
    maxAmount = basis * (rules.capMultiple ?? 0);
  } else {
    const qualified =
      emp.netSalary - emp.internalRecoveries - emp.externalRecoveries;
    maxAmount = Math.max(
      0,
      qualified * (rules.takehomeFactor ?? 0) * (rules.takehomeMultiplier ?? 0),
    );
    if (qualified <= 0) {
      reasons.push("Take-home after deductions is zero or negative.");
    }
  }

  return {
    eligible: reasons.length === 0 && maxAmount > 0,
    maxAmount,
    reasons,
    interestApplies: rules.interestApplies,
    maxTenorMonths: rules.maxTenorMonths,
    requiresExternalDeclaration: rules.requiresExternalDeclaration,
  };
}
