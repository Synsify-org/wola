import Link from "next/link";
import { ScrollText, ArrowRight } from "lucide-react";

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
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-soft">Show me everything; let me change nothing.</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-rule bg-surface shadow-theme-md">
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-brand-700">
              <ScrollText className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-semibold text-ink">Recent activity</h2>
          </div>
          <Link href="/audit-log" className="text-xs font-medium text-brand hover:underline">
            Full audit log &rarr;
          </Link>
        </div>
        {rows.length === 0 ? (
          <p className="p-5 text-sm text-ink-soft">No activity recorded yet.</p>
        ) : (
          <table className="ledger mt-2">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num whitespace-nowrap text-xs text-ink-soft">
                    {new Date(r.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="text-sm text-ink">{r.actorEmail ?? "System"}</td>
                  <td className="text-sm text-ink">{label(r.action)}</td>
                  <td className="text-sm text-ink-soft">{r.entity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Supporting: read-only views, nothing else. No action control anywhere. */}
      <section className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Loan book", href: "/book" },
          { label: "Applications", href: "/applications" },
          { label: "Approvals log", href: "/approvals" },
        ].map((v) => (
          <Link
            key={v.href}
            href={v.href}
            className="flex items-center justify-between rounded-xl border border-rule bg-surface p-4 shadow-theme-sm transition-colors hover:border-brand-200 hover:bg-brand-wash"
          >
            <span className="text-sm font-medium text-ink">{v.label}</span>
            <ArrowRight className="h-4 w-4 text-ink-faint" />
          </Link>
        ))}
      </section>
    </div>
  );
}
