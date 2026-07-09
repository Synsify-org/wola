// apps/web/src/app/api/apply/route.ts
// Handles loan application submission. Re-validates eligibility SERVER-SIDE
// (client input is never trusted), creates the application, and — for this
// stub-approval slice — auto-approves into a loan and generates its schedule.
// Real approval workflow (Dept Head → HR → CFO → CEO) replaces the stub later.
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/guard";
import { getEmployeeProfile, persistSchedule } from "@wola/db";
import { assessEligibility, type LoanKind } from "@wola/engine";

// map form loan kind -> loan_products.kind in the DB
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

    // SERVER-SIDE re-validation — the client cannot be trusted.
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

    // Find the loan product for this kind in this tenant.
    const [product] = await tx`
      SELECT id FROM loan_products
      WHERE kind = ${KIND_TO_PRODUCT[kind]} AND active = true LIMIT 1`;
    if (!product) return { error: "No matching loan product configured." };

    // Create the application (frozen eligibility snapshot for audit).
    const [appn] = await tx`
      INSERT INTO loan_applications
        (tenant_id, employee_id, loan_product_id, amount, tenor_months,
         declared_external_loans, status, eligibility_snapshot)
      VALUES
        (${tenantId}, ${profile.employeeId}, ${product.id}, ${amount}, ${tenor},
         ${tx.json(kind === "car" ? [{ monthly: externalRecoveries }] : [])},
         'approved',
         ${tx.json({ kind, maxAmount: elig.maxAmount, interestApplies: elig.interestApplies })})
      RETURNING id`;

    // STUB APPROVAL: immediately create the loan. Real pipeline replaces this.
    // Interest: 0 for advance, else a placeholder CBR (wire to rate_indices later).
    const annualRate = elig.interestApplies ? 0.16 : 0;
    const [loan] = await tx`
      INSERT INTO loans
        (tenant_id, application_id, principal, annual_rate, rate_mode,
         start_date, tenor_months, status)
      VALUES
        (${tenantId}, ${appn.id}, ${amount}, ${annualRate}, 'fixed',
         ${new Date()}, ${tenor}, 'active')
      RETURNING id`;

    // STUB: in the real workflow the CFO generates the schedule at their
    // approval stage (spec step 5). Generated here so the stubbed flow is
    // demoable end-to-end. Move this into the CFO approval action later.
    await persistSchedule(tx, {
      tenantId, loanId: loan.id as string,
      principal: amount, annualRate, tenorMonths: tenor,
      startDate: new Date(), decimals: 0, // UGX = whole shillings
    });

    return { loanId: loan.id as string };
  });

  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  redirect(`/loans/${result.loanId}`);
}