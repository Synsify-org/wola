import Link from "next/link";
import { ArrowRight, Building2, CheckSquare, FileBarChart, FileText } from "lucide-react";
import DashboardCard from "./dashboard-card";

export type AuditRow = {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorEmail: string | null;
  at: string;
};

const label = (s: string) => s.replace(/_/g, " ").replace(/\./g, " · ");

// The Auditor hero: "show me everything, let me change nothing." The audit
// log itself is the centrepiece — read-only is the defining trait, and the
// absence of any action control anywhere on this page IS the design signal,
// not an oversight. Enforced at the database role too (wola_app has no
// UPDATE/DELETE on audit_log), not merely hidden here.
export default function DashboardAuditor({ rows }: { rows: AuditRow[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3 xl:gap-5">
      <DashboardCard
        title="Recent activity"
        flush
        className="animate-in fade-in slide-in-from-bottom-2 duration-500 lg:col-span-2"
        action={
          <Link href="/audit-log" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
            Full audit log <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        {rows.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-ink-soft">No activity recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="ledger min-w-[34rem]">
              <thead>
                <tr>
                  <th className="pl-6!">When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th className="pr-6!">Entity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="num pl-6! text-[0.8125rem] text-ink-soft">
                      {new Date(r.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="text-ink">{r.actorEmail ?? "System"}</td>
                    <td className="text-ink">{label(r.action)}</td>
                    <td className="pr-6! text-ink-soft">{r.entity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DashboardCard>

      {/* Supporting: read-only views, nothing else. No action control anywhere. */}
      <DashboardCard title="Read-only views" className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150">
        <ul className="-mx-2 space-y-1">
          {[
            { label: "Loan book", href: "/book", icon: Building2 },
            { label: "Applications", href: "/applications", icon: FileText },
            { label: "Approvals log", href: "/approvals", icon: CheckSquare },
            { label: "Reports", href: "/reports", icon: FileBarChart },
          ].map((v) => (
            <li key={v.href}>
              <Link
                href={v.href}
                className="group flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-paper"
              >
                <span className="flex items-center gap-3 text-sm font-medium text-ink">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-700">
                    <v.icon className="h-4.5 w-4.5" strokeWidth={1.75} />
                  </span>
                  {v.label}
                </span>
                <ArrowRight className="h-4 w-4 text-ink-faint transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      </DashboardCard>
    </div>
  );
}
