// apps/web/src/app/admin/security/page.tsx — two-step sign-in for the platform console.
// The only /admin page a session that has not yet proven its second factor can reach.
import { redirect } from "next/navigation";
import { getMfaStatus, mfaKey } from "@wola/db";
import { requireSuperSession } from "@/lib/super-admin-guard";
import { db } from "@/lib/tenant";
import SuperAdminShell from "@/components/super-admin-shell";
import SecurityPanel from "@/components/security-panel";
import { pageMeta } from "@/lib/site";
import {
  superStartMfaAction, superConfirmMfaAction, superNewRecoveryCodesAction, superDisableMfaAction,
} from "../actions";

export const metadata = pageMeta({ title: "Platform security", description: "Two-step sign-in for the platform console.", path: "/admin/security" });

export default async function SuperSecurityPage() {
  const keyAvailable = mfaKey() !== null;
  const data = await requireSuperSession(async (ctx) => {
    const [u] = await db`SELECT email FROM users WHERE id = ${ctx.userId}`;
    return { email: (u?.email as string) ?? "", status: await getMfaStatus(db, ctx.userId) };
  }, { skipMfaGate: true });
  // No key on the server means nothing to set up (and nothing is enforced).
  if (!keyAvailable) redirect("/admin");

  return (
    <SuperAdminShell email={data.email}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink">Platform security</h1>
        <p className="mt-1 text-sm text-ink-soft">The platform console can see every organisation, so a second step at sign-in is required.</p>
      </div>
      <div className="max-w-3xl">
        <SecurityPanel
          enrolled={data.status.enrolled}
          recoveryCodesLeft={data.status.recoveryCodesLeft}
          keyAvailable
          requiredForMe
          setupRequired={!data.status.enrolled}
          requiredNote="The platform console requires two-step sign-in. Set it up to carry on."
          introNote="After your password, Wola asks for a 6-digit code from an authenticator app on your phone. This account can see every organisation, so a stolen or guessed password alone must never be enough."
          actions={{ start: superStartMfaAction, confirm: superConfirmMfaAction, renew: superNewRecoveryCodesAction, disable: superDisableMfaAction }}
        />
      </div>
    </SuperAdminShell>
  );
}
