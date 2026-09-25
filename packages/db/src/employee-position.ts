// packages/db/src/employee-position.ts
// The Employee hero (architecture doc §6.2): "where do I stand, and what
// comes out of my next payslip." Composes three things that already exist
// separately (per-loan ledger state, application routing, the apply-flow's
// own eligibility check) into one call so the dashboard isn't the thing that
// re-derives eligibility logic — it reuses exactly what apply/page.tsx uses.
import { getEmployeeProfile } from "./employee-financials";
import { loadProductRules } from "./product-rules";
import { routeApplication } from "./approvals";
import { repaymentPosition } from "./loans";
import { assessEligibility } from "@wola/engine";
import type { Tx } from "./client";

export interface LoanPosition {
  loanId: string;
  product: string;
  principal: number;
  outstanding: number;
  /** Next deduction amount, from the ledger (repaymentPosition). */
  monthlyDeduction: number;
  /** Next deduction date (YYYY-MM-DD); null when nothing is due. */
  nextDueDate: string | null;
  progressPct: number; // principal repaid / principal, 0-100
}

export interface ApplicationInFlight {
  applicationId: string;
  product: string;
  amount: number;
  stageRole: string | null; // null only if routing couldn't resolve a stage
}

export interface EligibilityPreviewItem {
  productId: string;
  productName: string;
  maxAmount: number;
}

export interface EmployeePosition {
  loans: LoanPosition[];
  applicationsInFlight: ApplicationInFlight[];
  eligibility: EligibilityPreviewItem[];
}

export async function employeePosition(
  tx: Tx, userId: string,
): Promise<EmployeePosition | null> {
  const profile = await getEmployeeProfile(tx, userId);
  if (!profile) return null;

  const loanRows = await tx`
    SELECT l.id, l.tenant_id, lp.name AS product
    FROM loans l
    JOIN loan_applications la ON la.id = l.application_id
    JOIN loan_products lp ON lp.id = la.loan_product_id
    WHERE la.employee_id = ${profile.employeeId} AND l.status = 'active'
    ORDER BY l.created_at ASC`;

  // Next deduction, outstanding and progress all come from the LEDGER via
  // repaymentPosition() — the same source the loan page and the repayment
  // allocator use. The old per-date query showed the first instalment's
  // amount on the next calendar date regardless of payments, so anyone who
  // paid early or in part saw the wrong figure. One call per active loan; an
  // employee has only a handful.
  const loans: LoanPosition[] = [];
  for (const r of loanRows) {
    const p = await repaymentPosition(tx, r.tenant_id as string, r.id as string);
    loans.push({
      loanId: r.id as string,
      product: r.product as string,
      principal: p.principal,
      outstanding: p.outstanding,
      monthlyDeduction: p.next?.amount ?? 0,
      nextDueDate: p.next?.dueDate ?? null,
      progressPct: p.principal > 0 ? Math.round((p.principalRepaid / p.principal) * 100) : 0,
    });
  }

  // Applications in flight, WITH their current stage — a small, per-employee
  // list (never more than a couple at once), so the routeApplication() call
  // per row is fine here in a way it wouldn't be for a tenant-wide inbox.
  const appRows = await tx`
    SELECT la.id, lp.name AS product, la.amount
    FROM loan_applications la
    JOIN loan_products lp ON lp.id = la.loan_product_id
    WHERE la.employee_id = ${profile.employeeId} AND la.status IN ('submitted', 'in_review')
    ORDER BY la.created_at DESC`;

  const applicationsInFlight: ApplicationInFlight[] = [];
  for (const r of appRows) {
    const loaded = await routeApplication(tx, r.id as string);
    applicationsInFlight.push({
      applicationId: r.id as string,
      product: r.product as string,
      amount: Number(r.amount),
      stageRole: loaded?.routing.currentStage?.approverRole ?? null,
    });
  }

  // Eligibility preview: identical inputs to apply/page.tsx's baseline
  // (externalRecoveries: 0 — the real value is only known once a specific
  // application's declaration is entered). Only products the employee could
  // actually borrow against right now are surfaced, matching the wireframe
  // ("Eligibility: up to X") — a 0/ineligible product isn't shown as a teaser.
  const products = await loadProductRules(tx);
  const eligibility: EligibilityPreviewItem[] = products
    .map((rules) => {
      const elig = assessEligibility(rules, {
        grossSalary: profile.grossSalary,
        netSalary: profile.netSalary,
        internalRecoveries: profile.internalRecoveries,
        externalRecoveries: 0,
        isPostProbation: profile.isPostProbation,
        onFinalWarning: profile.onFinalWarning,
        activeProductIds: profile.activeProductIds,
      });
      return { productId: rules.productId, productName: rules.name, maxAmount: elig.maxAmount, eligible: elig.eligible };
    })
    .filter((e) => e.eligible && e.maxAmount > 0)
    .map(({ productId, productName, maxAmount }) => ({ productId, productName, maxAmount }));

  return { loans, applicationsInFlight, eligibility };
}
