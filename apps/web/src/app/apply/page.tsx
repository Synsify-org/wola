// apps/web/src/app/apply/page.tsx — personalized loan application.
// Server component: loads the employee profile inside the tenant session,
// passes it to the client form. Auto-fills identity (spec: not hand-keyed).
import { requireSession } from "@/lib/guard";
import { getEmployeeProfile } from "@wola/db";
import ApplyForm from "./apply-form";

export default async function ApplyPage() {
  const profile = await requireSession(async (tx, { userId }) => {
    return getEmployeeProfile(tx, userId);
  });

  if (!profile) {
    return (
      <main style={{ maxWidth: 640, margin: "6vh auto", fontFamily: "system-ui", padding: "0 16px" }}>
        <h1>Apply for a loan</h1>
        <p style={{ color: "#666" }}>No employee record is linked to your account. Contact HR.</p>
      </main>
    );
  }

  // Pass only what the client needs — never the whole DB row.
  return <ApplyForm profile={{
    fullName: profile.fullName,
    employeeNo: profile.employeeNo,
    title: profile.title,
    department: profile.department,
    departmentHead: profile.departmentHead,
    grossSalary: profile.grossSalary,
    netSalary: profile.netSalary,
    isPostProbation: profile.isPostProbation,
    onFinalWarning: profile.onFinalWarning,
    internalRecoveries: profile.internalRecoveries,
    externalRecoveries: 0,
    hasActiveDevelopmentLoan: profile.hasActiveDevelopmentLoan,
    hasActiveCarLoan: profile.hasActiveCarLoan,
  }} />;
}
