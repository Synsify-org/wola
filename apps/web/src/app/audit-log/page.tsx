// apps/web/src/app/audit-log/page.tsx — read-only audit trail.
// Primary home for the auditor role; also available to any full-book role
// (canSeeAllLoans) for oversight. RLS scopes audit_log to the tenant; wola_app
// has SELECT+INSERT only on this table (append-only, migration 0001) so this
// page can never be the thing that mutates the trail it's displaying.
import { headers } from "next/headers";
import { requireSession } from "@/lib/guard";
import { resolveTenant } from "@wola/db";
import { db } from "@/lib/tenant";
import Shell from "@/components/shell";
import { ScrollText } from "lucide-react";

type Row = {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  actor_email: string | null;
  at: string;
};

const label = (s: string) => s.replace(/_/g, " ").replace(/\./g, " · ");

export default async function AuditLogPage() {
  const slug = (await headers()).get("x-tenant-slug") ?? "";
  const tenant = slug ? await resolveTenant(db, slug) : null;

  const data = await requireSession(async (tx, ctx) => {
    const [me] = await tx`SELECT e.full_name, u.email FROM users u LEFT JOIN employees e ON e.user_id = u.id WHERE u.id = ${ctx.userId}`;
    const user = {
      name: (me?.full_name as string) ?? (me?.email as string) ?? "-",
      email: (me?.email as string) ?? "",
      role: ctx.role,
      canSeeAllLoans: ctx.canSeeAllLoans,
      canApprove: ctx.canApprove,
    };

    if (!ctx.canSeeAllLoans) return { user, authorized: false as const };

    // Most-recent-first, capped — a full filter/search UI is a follow-on, not
    // this pass. TODO @wola/db: move this into a listAuditLog() export once a
    // second caller needs it.
    const rows = (await tx`
      SELECT a.id, a.action, a.entity, a.entity_id, a.at, u.email AS actor_email
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.actor_id
      ORDER BY a.at DESC
      LIMIT 200`) as unknown as Row[];

    return { user, authorized: true as const, rows };
  });

  if (!data.authorized) {
    return (
      <Shell user={data.user} tenantName={(tenant?.name as string) ?? "Wola"}>
        <div className="rounded-xl border border-rule bg-surface p-8 text-center shadow-theme-sm">
          <p className="text-sm text-ink-soft">The audit log is available to management and audit roles only.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell user={data.user} tenantName={(tenant?.name as string) ?? "Wola"}>
      <div className="mb-6 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-100 text-brand-700">
          <ScrollText className="h-5 w-5" strokeWidth={2} />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-ink">Audit log</h1>
          <p className="mt-1 text-sm text-ink-soft">Every recorded mutation, most recent first. Append-only — nothing here can be edited or deleted.</p>
        </div>
      </div>

      {data.rows.length === 0 ? (
        <div className="rounded-xl border border-rule bg-surface p-12 text-center shadow-theme-sm">
          <p className="text-sm text-ink-soft">No activity recorded yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-rule bg-surface shadow-theme-sm">
          <table className="ledger">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="num text-xs text-ink-soft whitespace-nowrap">
                    {new Date(r.at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="text-sm text-ink">{r.actor_email ?? "System"}</td>
                  <td className="text-sm text-ink">{label(r.action)}</td>
                  <td className="text-sm text-ink-soft">{r.entity}</td>
                  <td className="num text-xs text-ink-faint">{r.entity_id ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
