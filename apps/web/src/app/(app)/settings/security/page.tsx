// Security: two-step sign-in for the signed-in person (everyone can use it), and
// for administrators the policy of which roles must. This page uses
// skipMfaGate: it is where a person who is REQUIRED to enrol goes to do so.
import { getMfaStatus, mfaKey } from "@wola/db";
import { requireSession } from "@/lib/guard";
import { db } from "@/lib/tenant";
import { ACCESS_EDIT_ROLES } from "@/lib/permissions";
import Breadcrumbs from "@/components/breadcrumbs";
import SecurityPanel, { MfaPolicyPanel } from "@/components/security-panel";
import { pageMeta } from "@/lib/site";

export const metadata = pageMeta({
  title: "Security",
  description: "Two-step sign-in for your account, and which roles in your organisation must use it.",
  path: "/settings/security",
});

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ setup?: string }> }) {
  const { setup } = await searchParams;
  const keyAvailable = mfaKey() !== null;

  const data = await requireSession(async (tx, ctx) => {
    const [t] = await tx`SELECT settings FROM tenants WHERE id = ${ctx.tenantId}`;
    const required = ((t?.settings ?? {}) as { security?: { mfaRequiredRoles?: string[] } }).security?.mfaRequiredRoles ?? [];
    return {
      status: await getMfaStatus(db, ctx.userId),
      required,
      requiredForMe: keyAvailable && required.includes(ctx.role),
      canEditPolicy: ACCESS_EDIT_ROLES.includes(ctx.role),
    };
  }, { skipMfaGate: true });

  return (
    <>
      <Breadcrumbs items={[{ label: "Settings", href: "/settings" }, { label: "Security" }]} />
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink">Security</h1>
        <p className="mt-1 text-sm text-ink-soft">Protect your account with a second step when you sign in.</p>
      </div>

      <div className="max-w-3xl space-y-5">
        <SecurityPanel
          enrolled={data.status.enrolled}
          recoveryCodesLeft={data.status.recoveryCodesLeft}
          keyAvailable={keyAvailable}
          requiredForMe={data.requiredForMe}
          setupRequired={setup === "required"}
        />
        {data.canEditPolicy ? <MfaPolicyPanel initial={data.required} keyAvailable={keyAvailable} /> : null}
      </div>
    </>
  );
}
