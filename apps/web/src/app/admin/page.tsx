// apps/web/src/app/admin/page.tsx — Overview tab (spec §6.1 tab 1).
// Cross-tenant statistics, not any one tenant's book.
import { requireSuperSession } from "@/lib/super-admin-guard";
import { platformOverview } from "@wola/db";
import { db } from "@/lib/tenant";
import SuperAdminShell from "@/components/super-admin-shell";
import { Building2, Layers, Banknote, Wallet } from "lucide-react";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();

export default async function SuperAdminOverview() {
  const data = await requireSuperSession(async (ctx) => {
    const [u] = await db`SELECT email FROM users WHERE id = ${ctx.userId}`;
    const overview = await platformOverview(db);
    return { email: (u?.email as string) ?? "", overview };
  });

  const { email, overview } = data;

  const Metric = ({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Building2 }) => (
    <div className="rounded-xl border border-rule bg-surface p-5 shadow-theme-sm">
      <div className="flex items-center justify-between">
        <span className="caps">{label}</span>
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-50 text-brand-700">
          <Icon className="h-4.5 w-4.5" />
        </span>
      </div>
      <div className="num mt-3 text-2xl font-bold text-ink">{value}</div>
    </div>
  );

  return (
    <SuperAdminShell email={email}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink">Overview</h1>
        <p className="mt-1 text-sm text-ink-soft">Across every tenant on the platform.</p>
      </div>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric
          label="Tenants"
          value={`${overview.activeTenantCount} / ${overview.tenantCount}`}
          icon={Building2}
        />
        <Metric label="Active loans" value={String(overview.totalActiveLoans)} icon={Layers} />
        <Metric label="Principal disbursed" value={ugx(overview.totalPrincipalDisbursed)} icon={Banknote} />
        <Metric label="Outstanding" value={ugx(overview.totalOutstanding)} icon={Wallet} />
      </section>

      <p className="mt-6 text-xs text-ink-soft">
        &quot;Tenants&quot; shows active tenants out of all onboarded tenants.
      </p>
    </SuperAdminShell>
  );
}
