// apps/web/src/app/api/apply/route.ts
// Submits an application into the approval pipeline.
//
// Eligibility is re-validated SERVER-SIDE against the tenant''s product
// configuration. The client form is a convenience; this is the authority.
// A tampered amount in the hidden field dies here.
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/guard";
import { getEmployeeProfile, loadProductRules } from "@wola/db";
import { assessEligibility } from "@wola/engine";

export async function POST(req: Request) {
  const form = await req.formData();
  const productId = String(form.get("productId") ?? "");
  const amount = Number(form.get("amount"));
  const tenor = Number(form.get("tenor"));
  const external = Number(form.get("externalRecoveries")) || 0;

  const result = await requireSession(async (tx, { tenantId, userId }) => {
    const profile = await getEmployeeProfile(tx, userId);
    if (!profile) return { error: "No employee record." };

    const products = await loadProductRules(tx);
    const rules = products.find((p) => p.productId === productId);
    if (!rules) return { error: "That loan product is not available." };

    const elig = assessEligibility(rules, {
      grossSalary: profile.grossSalary,
      netSalary: profile.netSalary,
      internalRecoveries: profile.internalRecoveries,
      externalRecoveries: rules.requiresExternalDeclaration ? external : 0,
      isPostProbation: profile.isPostProbation,
      onFinalWarning: profile.onFinalWarning,
      activeProductIds: profile.activeProductIds,
    });

    if (!elig.eligible) return { error: elig.reasons.join(" ") };
    if (amount <= 0 || amount > elig.maxAmount) {
      return { error: "Amount exceeds what you qualify for." };
    }
    if (tenor < 1 || tenor > elig.maxTenorMonths) {
      return { error: "Repayment period exceeds the limit for this product." };
    }

    // The snapshot freezes what was assessed at submission, so an approver
    // sees the figures the applicant saw, not a recomputed value that could
    // have drifted if config changed mid-flight.
    const [appn] = await tx`
      INSERT INTO loan_applications
        (tenant_id, employee_id, loan_product_id, amount, tenor_months,
         declared_external_loans, status, eligibility_snapshot)
      VALUES
        (${tenantId}, ${profile.employeeId}, ${productId}, ${amount}, ${tenor},
         ${tx.json(rules.requiresExternalDeclaration ? [{ monthly: external }] : [])},
         'submitted',
         ${tx.json({
           product: rules.name,
           maxAmount: elig.maxAmount,
           interestApplies: elig.interestApplies,
           capMethod: rules.capMethod,
         })})
      RETURNING id`;

    return { applicationId: appn.id as string };
  });

  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  redirect("/applications/" + result.applicationId);
}
