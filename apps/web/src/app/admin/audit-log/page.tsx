// apps/web/src/app/admin/audit-log/page.tsx — Activity: what happened, and who did it.
// Two views: what happened INSIDE organisations (their audit logs, merged), and what Wola
// OPERATORS did (sign-ins, two-step enrolment, which organisations they opened). Both are
// append-only at the database level: nothing here can be edited or deleted.
import Link from "next/link";
import { requireSuperSession } from "@/lib/super-admin-guard";
import { crossTenantAuditLog, listPlatformEvents } from "@wola/db";
import { db } from "@/lib/tenant";
import SuperAdminShell from "@/components/super-admin-shell";
import ActivityFilters from "@/components/admin/activity-filters";
import { Empty, Panel, timeAgo } from "@/components/admin/parts";
import { pageMeta } from "@/lib/site";

export const metadata = pageMeta({ title: "Platform activity", description: "What happened in organisations, and what Wola operators did.", path: "/admin/audit-log" });
export const dynamic = "force-dynamic";

const words = (s: string) => s.replace(/[_.]/g, " ").replace(/^platform /, "");
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ view?: string; tenant?: string; q?: string }> }) {
  const sp = await searchParams;
  const view = sp.view === "operators" ? "operators" : "organisations";
  const q = (sp.q ?? "").trim().toLowerCase().slice(0, 60);
  const slug = (sp.tenant ?? "").trim().slice(0, 60);

  const data = await requireSuperSession(async (ctx) => {
    const [u] = await db`SELECT email FROM users WHERE id = ${ctx.userId}`;
    const tenants = await db`SELECT id, slug, name FROM tenants ORDER BY name`;
    const chosen = tenants.find((t) => t.slug === slug);
    const orgRows = view === "organisations" ? await crossTenantAuditLog(db, 100, 400) : [];
    const opRows = view === "operators" ? await listPlatformEvents(db, { limit: 200, tenantId: (chosen?.id as string) ?? null }) : [];
    return { email: (u?.email as string) ?? "", tenants, orgRows, opRows };
  });

  const orgRows = data.orgRows
    .filter((r) => (!slug || r.tenantSlug === slug) && (!q || `${r.action} ${r.entity} ${r.actorEmail ?? ""} ${r.tenantName}`.toLowerCase().includes(q)))
    .slice(0, 150);
  const opRows = data.opRows.filter((e) => !q || `${e.action} ${e.actorEmail ?? ""} ${e.tenantName ?? ""}`.toLowerCase().includes(q));

  const tab = (v: string, text: string) => (
    <Link
      href={`/admin/audit-log?view=${v}${slug ? `&tenant=${encodeURIComponent(slug)}` : ""}`}
      aria-current={view === v ? "page" : undefined}
      className={"rounded-full border px-4 py-2 text-sm font-medium " + (view === v ? "border-brand-200 bg-brand-50 text-brand-800" : "border-rule bg-surface text-ink-soft hover:text-ink")}
    >
      {text}
    </Link>
  );

  return (
    <SuperAdminShell email={data.email}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink">Activity</h1>
        <p className="mt-1 text-sm text-ink-soft">Newest first. Read-only: nothing here can be edited or deleted.</p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {tab("organisations", "Inside organisations")}
        {tab("operators", "Wola operators")}
      </div>

      <ActivityFilters view={view} tenant={slug} q={(sp.q ?? "").slice(0, 60)} tenants={data.tenants.map((t) => ({ slug: t.slug as string, name: t.name as string }))} />

      {view === "organisations" ? (
        <Panel title="Inside organisations" action={<span className="text-xs text-ink-soft">{orgRows.length} shown</span>}>
          {orgRows.length === 0 ? (
            <Empty>{slug || q ? "Nothing matches those filters." : "No activity recorded yet. Approvals, repayments, role changes and similar actions will appear here."}</Empty>
          ) : (
            <ul className="divide-y divide-rule">
              {orgRows.map((r, i) => (
                <li key={i} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="break-words font-medium capitalize text-ink">{words(r.action)}</span>
                    <span className="block break-words text-xs text-ink-soft">{r.actorEmail ?? "System"} · {r.tenantName} · {r.entity}</span>
                  </span>
                  <span className="num shrink-0 whitespace-nowrap text-xs text-ink-faint">{when(r.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : (
        <Panel title="Wola operators" action={<span className="text-xs text-ink-soft">{opRows.length} shown</span>}>
          {opRows.length === 0 ? (
            <Empty>{slug || q ? "Nothing matches those filters." : "No operator activity recorded yet. Sign-ins, two-step enrolment and organisations an operator opens will appear here."}</Empty>
          ) : (
            <ul className="divide-y divide-rule">
              {opRows.map((e) => (
                <li key={e.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="break-words font-medium capitalize text-ink">{words(e.action)}</span>
                    <span className="block break-words text-xs text-ink-soft">{e.actorEmail ?? "An operator"}{e.tenantName ? ` · ${e.tenantName}` : ""}{e.ip ? ` · ${e.ip}` : ""}</span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-xs text-ink-faint" title={when(e.at)}>{timeAgo(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </SuperAdminShell>
  );
}
