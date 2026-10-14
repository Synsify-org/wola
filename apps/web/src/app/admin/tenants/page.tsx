// apps/web/src/app/admin/tenants/page.tsx — every organisation on the platform, searchable,
// each linking to its own page. Read-only.
import { requireSuperSession } from "@/lib/super-admin-guard";
import { platformConsole } from "@wola/db";
import { db } from "@/lib/tenant";
import SuperAdminShell from "@/components/super-admin-shell";
import OrgList from "@/components/admin/org-list";
import { pageMeta } from "@/lib/site";

export const metadata = pageMeta({ title: "Organisations", description: "Every organisation on the platform.", path: "/admin/tenants" });
export const dynamic = "force-dynamic";

export default async function OrganisationsPage() {
  const { email, orgs } = await requireSuperSession(async (ctx) => {
    const [u] = await db`SELECT email FROM users WHERE id = ${ctx.userId}`;
    return { email: (u?.email as string) ?? "", orgs: (await platformConsole(db)).orgs };
  });

  return (
    <SuperAdminShell email={email}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink">Organisations</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {orgs.length} onboarded organisation{orgs.length === 1 ? "" : "s"}. Open one to see its people, its loan book and what has happened there.
        </p>
      </div>
      <OrgList orgs={orgs} />
    </SuperAdminShell>
  );
}
