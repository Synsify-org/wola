// apps/web/src/app/admin/tenants/[id]/page.tsx — one organisation, in full, for a Wola operator.
// Read-only: the console shows and explains, it never changes an organisation's records.
// Opening this page is itself recorded in the operators' audit trail (who looked at whom).
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { AlertTriangle, ChevronLeft, Info } from "lucide-react";
import { requireSuperSession } from "@/lib/super-admin-guard";
import { orgDetail, orgAttention, recordPlatformEvent } from "@wola/db";
import { clientIp } from "@/lib/client-ip";
import { db } from "@/lib/tenant";
import SuperAdminShell from "@/components/super-admin-shell";
import StatCard from "@/components/stat-card";
import { Empty, Panel, StatusChip, timeAgo } from "@/components/admin/parts";
import { roleLabel } from "@/lib/product-summary";
import { formatMoney } from "@wola/engine";
import { pageMeta } from "@/lib/site";

export const metadata = pageMeta({ title: "Organisation", description: "One organisation's people, loan book and recent activity.", path: "/admin/tenants" });
export const dynamic = "force-dynamic";

const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const words = (s: string) => s.replace(/[_.]/g, " ");
const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function OrganisationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ip = clientIp(await headers());
  const data = await requireSuperSession(async (ctx) => {
    const [u] = await db`SELECT email FROM users WHERE id = ${ctx.userId}`;
    const detail = await orgDetail(db, id);
    if (detail) await recordPlatformEvent(db, { actorId: ctx.userId, action: "platform.viewed_tenant", tenantId: id, ip });
    return { email: (u?.email as string) ?? "", detail };
  });
  if (!data.detail) notFound();
  const { org, people, roles, loansByStatus, applicationsByStatus, mfaRequiredRoles, loanExitPolicy, recent, operatorViews } = data.detail;
  const attention = orgAttention(org);
  const money = (n: number) => formatMoney(n, org.currency);

  return (
    <SuperAdminShell email={data.email}>
      <Link href="/admin/tenants" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-ink-soft hover:text-ink">
        <ChevronLeft className="h-4 w-4" aria-hidden /> Organisations
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="break-words text-xl font-semibold text-ink">{org.name}</h1>
          <p className="mt-1 text-sm text-ink-soft"><span className="num">{org.slug}</span> · {org.plan} plan · {org.currency} · onboarded {date(org.createdAt)}</p>
        </div>
        <StatusChip status={org.status} />
      </div>

      {attention.length > 0 ? (
        <ul className="mb-6 space-y-2" aria-label="Needs attention">
          {attention.map((a, i) => (
            <li key={i} className={"flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm " + (a.severity === "warn" ? "border-awaiting/30 bg-awaiting-wash text-ink" : "border-rule bg-surface text-ink-soft")}>
              {a.severity === "warn" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-awaiting" aria-hidden /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-info-600" aria-hidden />}
              <span>{a.text}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <section className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label="Figures">
        <StatCard tone="info" label="People" value={String(org.people)} sub={`${org.employees} employees on record`} />
        <StatCard tone="teal" label="Active loans" value={String(org.activeLoans)} sub={`${org.inFlight} application${org.inFlight === 1 ? "" : "s"} in review`} />
        <StatCard tone="deep" label="Outstanding" value={money(org.outstanding)} sub={`${money(org.principal)} lent`} />
        <StatCard tone={org.arrearsLoans ? "warn" : "success"} label="Behind on payments" value={String(org.arrearsLoans)} sub={org.arrearsLoans ? `${money(org.arrears)} overdue` : "Up to date"} />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 xl:gap-5">
        <div className="min-w-0 space-y-4 lg:col-span-2 xl:space-y-5">
          <Panel title="People" action={<span className="text-xs text-ink-soft">{people.length} with access</span>}>
            {people.length === 0 ? <Empty>Nobody has access yet.</Empty> : (
              <>
                <div className="flex flex-wrap gap-2 border-b border-rule px-5 py-3">
                  {roles.map((r) => <span key={r.role} className="chip">{roleLabel(r.role)} · {r.n}</span>)}
                </div>
                <ul className="divide-y divide-rule">
                  {people.map((p) => (
                    <li key={p.email} className="flex items-start justify-between gap-3 px-5 py-3">
                      <span className="min-w-0 text-sm">
                        <span className="block break-words font-medium text-ink">{p.name}</span>
                        <span className="block break-words text-xs text-ink-soft">{p.email}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="chip">{roleLabel(p.role)}</span>
                        <span className={p.mfa ? "chip chip--approved" : "text-xs text-ink-faint"}>{p.mfa ? "2-step on" : "2-step off"}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>

          <Panel title="Recent activity in this organisation">
            {recent.length === 0 ? <Empty>No activity recorded yet.</Empty> : (
              <ul className="divide-y divide-rule">
                {recent.map((r, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                    <span className="min-w-0">
                      <span className="break-words font-medium capitalize text-ink">{words(r.action)}</span>
                      <span className="block break-words text-xs text-ink-soft">{r.actorEmail ?? "System"} · {r.entity}</span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-xs text-ink-faint">{timeAgo(r.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-4 xl:space-y-5">
          <Panel title="Loan book">
            {loansByStatus.length === 0 ? <Empty>No loans yet.</Empty> : (
              <ul className="divide-y divide-rule">
                {loansByStatus.map((l) => (
                  <li key={l.status} className="flex items-baseline justify-between gap-3 px-5 py-3 text-sm">
                    <span className="text-ink">{label(l.status)}</span>
                    <span className="num text-right text-ink-soft">{l.n} · {money(l.principal)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Applications">
            {applicationsByStatus.length === 0 ? <Empty>No applications yet.</Empty> : (
              <ul className="divide-y divide-rule">
                {applicationsByStatus.map((a) => (
                  <li key={a.status} className="flex items-baseline justify-between gap-3 px-5 py-3 text-sm">
                    <span className="text-ink">{label(a.status)}</span>
                    <span className="num text-ink-soft">{a.n}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Access and policy">
            <dl className="space-y-3 px-5 py-4 text-sm">
              <div>
                <dt className="text-xs text-ink-soft">Two-step sign-in required for</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {mfaRequiredRoles.length ? mfaRequiredRoles.map((r) => <span key={r} className="chip chip--approved">{roleLabel(r)}</span>) : <span className="text-ink-soft">No roles yet</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-soft">When a borrower leaves</dt>
                <dd className="mt-0.5 text-ink">{loanExitPolicy === "manual" ? "Handled by hand" : "Ask for the balance"}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-soft">Email</dt>
                <dd className="mt-0.5 text-ink">{org.emailsPending} waiting · {org.emailsFailed} failed</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-soft">Last sign-in</dt>
                <dd className="mt-0.5 text-ink">{org.lastSignInAt ? timeAgo(org.lastSignInAt) : "None recorded"}</dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Who from Wola looked here">
            {operatorViews.length === 0 ? <Empty>No operator has opened this page yet.</Empty> : (
              <ul className="divide-y divide-rule">
                {operatorViews.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                    <span className="min-w-0 break-words text-ink">{e.actorEmail ?? "An operator"}</span>
                    <span className="shrink-0 whitespace-nowrap text-xs text-ink-faint">{timeAgo(e.at)}</span>
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
