// apps/web/src/app/api/apply/route.ts
// Submits a loan application into the APPROVAL PIPELINE.
// No auto-approval, no schedule: the application enters the configured chain
// (dept_head → HR → CFO → CEO for MUA) and the CFO generates the schedule at
// their stage (spec step 5). Eligibility is re-validated SERVER-SIDE here —
// the client form is a convenience, this is the authority.
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/guard";
import { getEmployeeProfile } from "@wola/db";
import { assessEligibility, type LoanKind } from "@wola/engine";

const KIND_TO_PRODUCT: Record<LoanKind, string> = {
  advance: "advance", development: "term", car: "asset",
};

export async function POST(req: Request) {
  const form = await req.formData();
  const kind = String(form.get("kind")) as LoanKind;
  const amount = Number(form.get("amount"));
  const tenor = Number(form.get("tenor"));
  const externalRecoveries = Number(form.get("externalRecoveries")) || 0;

  const result = await requireSession(async (tx, { tenantId, userId }) => {
    const profile = await getEmployeeProfile(tx, userId);
    if (!profile) return { error: "No employee record." };

    const elig = assessEligibility(kind, {
      ...profile,
      externalRecoveries: kind === "car" ? externalRecoveries : 0,
    });
    if (!elig.eligible) return { error: elig.reasons.join(" ") };
    if (amount <= 0 || amount > elig.maxAmount) {
      return { error: `Amount exceeds your cap of ${elig.maxAmount}.` };
    }
    if (tenor < 1 || tenor > elig.maxTenorMonths) {
      return { error: `Tenor exceeds the ${elig.maxTenorMonths}-month limit.` };
    }

    const [product] = await tx`
      SELECT id FROM loan_products
      WHERE kind = ${KIND_TO_PRODUCT[kind]} AND active = true LIMIT 1`;
    if (!product) return { error: "No matching loan product configured." };

    // Enter the pipeline as 'submitted'. The eligibility snapshot is FROZEN
    // here so approvers see what was assessed at submission, not a recomputed
    // value that could have drifted.
    const [appn] = await tx`
      INSERT INTO loan_applications
        (tenant_id, employee_id, loan_product_id, amount, tenor_months,
         declared_external_loans, status, eligibility_snapshot)
      VALUES
        (${tenantId}, ${profile.employeeId}, ${product.id}, ${amount}, ${tenor},
         ${tx.json(kind === "car" ? [{ monthly: externalRecoveries }] : [])},
         'submitted',
         ${tx.json({ kind, maxAmount: elig.maxAmount, interestApplies: elig.interestApplies })})
      RETURNING id`;

    return { applicationId: appn.id as string };
  });

  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  redirect(`/applications/${result.applicationId}`);
}