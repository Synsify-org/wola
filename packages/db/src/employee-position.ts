// packages/db/src/employee-position.ts
// The Employee hero (architecture doc §6.2): "where do I stand, and what
// comes out of my next payslip." Composes three things that already exist
// separately (per-loan ledger state, application routing, the apply-flow's
// own eligibility check) into one call so the dashboard isn't the thing that
// re-derives eligibility logic — it reuses exactly what apply/page.tsx uses.
import { getEmployeeProfile } from "./employee-financials";
import { loadProductRules } from "./product-rules";
import { routeApplication } from "./approvals";
import { assessEligibility } from "@wola/engine";
import type { Tx } from "./client";

export interface LoanPosition {
  loanId: string;
  product: string;
  principal: number;
  outstanding: number;
  monthlyDeduction: number;
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
    SELECT l.id, lp.name AS product, l.principal,
           (SELECT sl.instalment FROM schedule_lines sl
             JOIN loan_schedules s ON s.id = sl.schedule_id
            WHERE s.loan_id = l.id AND s.is_active
            ORDER BY sl.period_no LIMIT 1) AS instalment,
           (SELECT MIN(sl.due_date) FROM schedule_lines sl
             JOIN loan_schedules s ON s.id = sl.schedule_id
            WHERE s.loan_id = l.id AND s.is_active
              AND sl.due_date > CURRENT_DATE) AS next_due,
           GREATEST(l.principal - COALESCE(
             (SELECT sum((r.allocation->>'principal')::numeric)
                FROM repayments r WHERE r.loan_id = l.id),
             0
           ), 0) AS outstanding
    FROM loans l
    JOIN loan_applications la ON la.id = l.application_id
    JOIN loan_products lp ON lp.id = la.loan_product_id
    WHERE la.employee_id = ${profile.employeeId} AND l.status = 'active'
    ORDER BY l.created_at ASC`;

  const loans: LoanPosition[] = loanRows.map((r) => {
    const principal = Number(r.principal);
    const outstanding = Number(r.outstanding);
    return {
      loanId: r.id as string,
      product: r.product as string,
      principal,
      outstanding,
      monthlyDeduction: Number(r.instalment ?? 0),
      nextDueDate: r.next_due ? new Date(r.next_due as string).toISOString() : null,
      progressPct: principal > 0 ? Math.round(((principal - outstanding) / principal) * 100) : 0,
    };
  });

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
