// apps/web/src/app/(app)/apply/page.tsx
// Personalized application. Loads the tenant's product CONFIGURATION and the
// applicant's financials; the form computes eligibility live from both. The
// page knows nothing about advances or car loans.
import { requireSession } from "@/lib/guard";
import { getEmployeeProfile, loadProductRules } from "@wola/db";
import ApplyForm from "./apply-form";
import { AlertTriangle } from "lucide-react";

export default async function ApplyPage() {
  const data = await requireSession(async (tx, ctx) => {
    const profile = await getEmployeeProfile(tx, ctx.userId);
    const products = await loadProductRules(tx);
    return { profile, products };
  });

  if (!data.profile) {
    return (
      <div className="mx-auto max-w-2xl pt-8">
        <div className="rounded-2xl border border-rejected/30 bg-rejected-wash p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rejected/10">
            <AlertTriangle className="h-6 w-6 text-rejected" />
          </div>
          <h1 className="text-xl font-semibold text-ink">No employee profile linked</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
            We couldn&apos;t find an employee record associated with your account. Please contact your HR department to get this resolved before applying for a loan.
          </p>
        </div>
      </div>
    );
  }

  const p = data.profile;

  return (
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
  );
}
