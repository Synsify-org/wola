// apps/web/src/app/apply/page.tsx
// Personalized application. Loads the tenant''s product CONFIGURATION and the
// applicant''s financials; the form computes eligibility live from both. The
// page knows nothing about advances or car loans.
import { headers } from "next/headers";
import { requireSession } from "@/lib/guard";
import { getEmployeeProfile, loadProductRules, resolveTenant } from "@wola/db";
import { db } from "@/lib/tenant";
import Shell from "@/components/shell";
import ApplyForm from "./apply-form";

export default async function ApplyPage() {
  const slug = (await headers()).get("x-tenant-slug") ?? "";
  const tenant = slug ? await resolveTenant(db, slug) : null;

  const data = await requireSession(async (tx, ctx) => {
    const profile = await getEmployeeProfile(tx, ctx.userId);
    const products = await loadProductRules(tx);
    const [u] = await tx`SELECT email FROM users WHERE id = ${ctx.userId}`;
    return {
      profile,
      products,
      user: {
        name: profile?.fullName ?? (u?.email as string) ?? "-",
        email: (u?.email as string) ?? "",
        role: ctx.role,
        canSeeAllLoans: ctx.canSeeAllLoans,
      },
    };
  });

  const tenantName = (tenant?.name as string) ?? "Wola";

  if (!data.profile) {
    return (
      <Shell user={data.user} tenantName={tenantName}>
        <h1 className="text-2xl">Apply for a loan</h1>
        <div className="card rounded-xl mt-6">
          <p className="text-ink-soft">
            No employee record is linked to your account. Contact HR.
          </p>
        </div>
      </Shell>
    );
  }

  const p = data.profile;

  return (
    <Shell user={data.user} tenantName={tenantName}>
      <ApplyForm
        products={data.products}
        employee={{
          grossSalary: p.grossSalary,
          netSalary: p.netSalary,
          internalRecoveries: p.internalRecoveries,
          externalRecoveries: 0,
          isPostProbation: p.isPostProbation,
          onFinalWarning: p.onFinalWarning,
          activeProductIds: p.activeProductIds,
        }}
        identity={{
          fullName: p.fullName,
          employeeNo: p.employeeNo,
          title: p.title,
          department: p.department,
          departmentHead: p.departmentHead,
        }}
      />
    </Shell>
  );
}
