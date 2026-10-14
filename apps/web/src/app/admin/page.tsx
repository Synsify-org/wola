// apps/web/src/app/admin/page.tsx — the platform console's Overview.
// How every organisation is doing, what needs attention, whether the platform itself is set up
// properly, who the operators are, and what has happened lately. Read-only.
import Link from "next/link";
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, CircleDashed, Info, Layers, ShieldCheck, Users, Wallet } from "lucide-react";
import { requireSuperSession } from "@/lib/super-admin-guard";
import { platformConsole, listPlatformEvents, crossTenantAuditLog } from "@wola/db";
import { db } from "@/lib/tenant";
import SuperAdminShell from "@/components/super-admin-shell";
import StatCard from "@/components/stat-card";
import { Empty, Panel, StatusChip, timeAgo } from "@/components/admin/parts";
import { systemChecks, type Check } from "@/lib/platform-checks";
import { formatMoney } from "@wola/engine";
import { pageMeta } from "@/lib/site";

export const metadata = pageMeta({ title: "Platform overview", description: "How every organisation is doing, and whether the platform is set up properly.", path: "/admin" });
export const dynamic = "force-dynamic";

const words = (s: string) => s.replace(/[_.]/g, " ").replace(/\bplatform\b/, "").trim();
const CHECK_ICON: Record<Check["status"], { icon: typeof CheckCircle2; cls: string }> = {
  ok: { icon: CheckCircle2, cls: "text-approved" },
  warn: { icon: AlertTriangle, cls: "text-awaiting" },
  todo: { icon: CircleDashed, cls: "text-ink-faint" },
};

export default async function SuperAdminOverview() {
  const data = await requireSuperSession(async (ctx) => {
    const [u] = await db`SELECT email FROM users WHERE id = ${ctx.userId}`;
    const [c, mine, tenantAudit] = await Promise.all([platformConsole(db), listPlatformEvents(db, { limit: 8 }), crossTenantAuditLog(db, 6, 8)]);
    return { email: (u?.email as string) ?? "", c, mine, tenantAudit };
  });
  const { email, c, mine, tenantAudit } = data;
  const checks = systemChecks({ health: c.health, operators: c.operators });
  const issues = checks.filter((k) => k.status !== "ok").length;

  const money = (field: "outstanding" | "principal" | "arrears") =>
    c.money.length === 0 ? "—" : c.money.map((m) => formatMoney(m[field], m.currency)).join(" · ");

  // One feed: what organisations did and what operators did, newest first.
  const feed = [
    ...tenantAudit.map((r) => ({ at: r.at, who: r.actorEmail ?? "System", what: words(r.action), where: r.tenantName, operator: false })),
    ...mine.map((e) => ({ at: e.at, who: e.actorEmail ?? "Operator", what: words(e.action), where: e.tenantName ?? "Platform", operator: true })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);

  return (
    <SuperAdminShell email={email}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink">Platform overview</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Every organisation on Wola, at a glance. Updated {timeAgo(c.generatedAt)}; reload for the latest.
        </p>
      </div>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3" aria-label="Totals">
        <StatCard tone="brand" icon={Building2} label="Organisations" value={`${c.totals.activeOrgs} / ${c.totals.orgs}`} sub={c.totals.newOrgs30d ? `${c.totals.newOrgs30d} new in the last 30 days` : "Active of all onboarded"} />
        <StatCard tone="info" icon={Users} label="People" value={String(c.totals.people)} sub={`${c.totals.employees} employees on record`} />
        <StatCard tone="teal" icon={Layers} label="Active loans" value={String(c.totals.activeLoans)} sub={`${c.totals.inFlight} application${c.totals.inFlight === 1 ? "" : "s"} in review`} />
        <StatCard tone="deep" icon={Wallet} label="Outstanding" value={money("outstanding")} sub={`${money("principal")} lent in total`} />
        <StatCard tone={c.totals.arrearsLoans ? "warn" : "success"} icon={AlertTriangle} label="Behind on payments" value={String(c.totals.arrearsLoans)} sub={c.totals.arrearsLoans ? `${money("arrears")} overdue` : "Every loan is up to date"} />
        <StatCard tone={issues ? "warn" : "success"} icon={ShieldCheck} label="Platform checks" value={issues ? `${issues} to look at` : "All good"} sub={`${checks.length} checks, listed below`} />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 xl:gap-5">
        <div className="min-w-0 space-y-4 lg:col-span-2 xl:space-y-5">
          <Panel title="Needs attention" action={<span className="text-xs text-ink-soft">{c.attention.length} item{c.attention.length === 1 ? "" : "s"}</span>}>
            {c.attention.length === 0 ? (
              <Empty>Nothing needs attention right now.</Empty>
            ) : (
              <ul className="divide-y divide-rule">
                {c.attention.slice(0, 10).map((a, i) => (
                  <li key={i}>
                    <Link href={`/admin/tenants/${a.tenantId}`} className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-paper">
                      {a.severity === "warn" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-awaiting" aria-hidden /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-info-600" aria-hidden />}
                      <span className="min-w-0 flex-1 text-sm"><span className="font-medium text-ink">{a.tenantName}</span><span className="text-ink-soft">: {a.text}</span></span>
                      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Organisations" action={<Link href="/admin/tenants" className="text-xs font-medium text-brand hover:underline">See all</Link>}>
            {c.orgs.length === 0 ? (
              <Empty>No organisations have been onboarded yet.</Empty>
            ) : (
              <ul className="divide-y divide-rule">
                {c.orgs.slice(0, 8).map((o) => {
                  const share = c.money.find((m) => m.currency === o.currency)?.outstanding || 0;
                  const pct = share > 0 ? Math.round((o.outstanding / share) * 100) : 0;
                  return (
                    <li key={o.id}>
                      <Link href={`/admin/tenants/${o.id}`} className="block px-5 py-3.5 transition-colors hover:bg-paper">
                        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                          <span className="min-w-0 break-words font-medium text-ink">{o.name} <span className="num text-xs font-normal text-ink-faint">{o.slug}</span></span>
                          <StatusChip status={o.status} />
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-soft">
                          <span>{o.activeLoans} active loan{o.activeLoans === 1 ? "" : "s"}</span>
                          <span>{o.people} {o.people === 1 ? "person" : "people"}</span>
                          <span className="num">{formatMoney(o.outstanding, o.currency)} outstanding</span>
                          <span>{o.lastActivityAt ? `active ${timeAgo(o.lastActivityAt)}` : "no activity yet"}</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden>
                          <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(pct, o.outstanding > 0 ? 3 : 0)}%` }} />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Recent activity">
            {feed.length === 0 ? (
              <Empty>No activity recorded yet. Sign-ins, organisation changes and operator actions will appear here.</Empty>
            ) : (
              <ul className="divide-y divide-rule">
                {feed.map((f, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                    <span className="min-w-0">
                      <span className="break-words font-medium capitalize text-ink">{f.what}</span>
                      <span className="block break-words text-xs text-ink-soft">{f.who} · {f.where}{f.operator ? " · operator" : ""}</span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-xs text-ink-faint">{timeAgo(f.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-4 xl:space-y-5">
          <Panel title="Platform checks">
            <ul className="divide-y divide-rule">
              {checks.map((k) => {
                const { icon: Icon, cls } = CHECK_ICON[k.status];
                return (
                  <li key={k.id} className="flex items-start gap-3 px-5 py-3">
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cls}`} aria-hidden />
                    <span className="min-w-0 text-sm">
                      <span className="block font-medium text-ink">{k.label}</span>
                      <span className="block text-xs text-ink-soft">{k.detail}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="Operators" action={<Link href="/admin/security" className="text-xs font-medium text-brand hover:underline">Your security</Link>}>
            {c.operators.length === 0 ? (
              <Empty>No operators.</Empty>
            ) : (
              <ul className="divide-y divide-rule">
                {c.operators.map((o) => (
                  <li key={o.id} className="flex items-start justify-between gap-3 px-5 py-3">
                    <span className="min-w-0 text-sm">
                      <span className="block break-words font-medium text-ink">{o.name}</span>
                      <span className="block break-words text-xs text-ink-soft">{o.email}</span>
                      <span className="block text-xs text-ink-faint">{o.lastSignInAt ? `Last signed in ${timeAgo(o.lastSignInAt)}` : "Not signed in yet"}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <StatusChip status={o.status} />
                      <span className={o.mfaEnrolled ? "chip chip--approved" : "chip chip--awaiting"}>{o.mfaEnrolled ? "2-step on" : "2-step off"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </SuperAdminShell>
  );
}
