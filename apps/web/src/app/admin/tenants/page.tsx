// apps/web/src/app/admin/tenants/page.tsx — Tenant Registry tab (spec §6.1
// tab 2). Name, plan, status, loan volume, onboarding date, for every tenant.
import { requireSuperSession } from "@/lib/super-admin-guard";
import { tenantRegistry } from "@wola/db";
import { db } from "@/lib/tenant";
import SuperAdminShell from "@/components/super-admin-shell";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();
const shortDate = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function TenantRegistryPage() {
  const data = await requireSuperSession(async (ctx) => {
    const [u] = await db`SELECT email FROM users WHERE id = ${ctx.userId}`;
    const tenants = await tenantRegistry(db);
    return { email: (u?.email as string) ?? "", tenants };
  });

  const { email, tenants } = data;

  return (
    <SuperAdminShell email={email}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink">Tenant registry</h1>
        <p className="mt-1 text-sm text-ink-soft">{tenants.length} onboarded tenant{tenants.length === 1 ? "" : "s"}.</p>
      </div>

      {tenants.length === 0 ? (
        <div className="rounded-xl border border-rule bg-surface p-8 text-center shadow-theme-sm">
          <p className="text-sm text-ink-soft">No tenants onboarded yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-rule bg-surface shadow-theme-sm">
          <table className="ledger">
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Plan</th>
                <th>Status</th>
                <th className="r">Active loans</th>
                <th className="r">Principal disbursed</th>
                <th>Onboarded</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div className="font-medium text-ink">{t.name}</div>
                    <div className="num text-xs text-ink-faint">{t.slug}</div>
                  </td>
                  <td className="text-ink-soft">{t.plan}</td>
                  <td>
                    <span className={t.status === "active" ? "chip chip--approved" : "chip chip--awaiting"}>
                      {t.status}
                    </span>
                  </td>
                  <td className="r num">{t.activeLoans}</td>
                  <td className="r num">{ugx(t.principalDisbursed)}</td>
                  <td className="text-ink-soft">{shortDate(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SuperAdminShell>
  );
}
