// apps/web/src/app/admin/audit-log/page.tsx — Audit Logs tab (spec §6.1 tab
// 3). Cross-tenant view of material changes on every customer portal.
// Append-only at the database level (audit_log's own grant has no
// UPDATE/DELETE for wola_app, tenant or platform side alike).
import { requireSuperSession } from "@/lib/super-admin-guard";
import { crossTenantAuditLog } from "@wola/db";
import { db } from "@/lib/tenant";
import SuperAdminShell from "@/components/super-admin-shell";

const label = (s: string) => s.replace(/_/g, " ").replace(/\./g, " · ");

export default async function CrossTenantAuditLogPage() {
  const data = await requireSuperSession(async (ctx) => {
    const [u] = await db`SELECT email FROM users WHERE id = ${ctx.userId}`;
    const rows = await crossTenantAuditLog(db);
    return { email: (u?.email as string) ?? "", rows };
  });

  const { email, rows } = data;

  return (
    <SuperAdminShell email={email}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink">Audit logs</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Most recent activity across every tenant, newest first. Read-only — nothing here can be edited or deleted.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-rule bg-surface p-12 text-center shadow-theme-sm">
          <p className="text-sm text-ink-soft">No activity recorded yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-rule bg-surface shadow-theme-sm">
          <table className="ledger">
            <thead>
              <tr>
                <th>When</th>
                <th>Tenant</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="num whitespace-nowrap text-xs text-ink-soft">
                    {new Date(r.at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="text-sm text-ink">{r.tenantName}</td>
                  <td className="text-sm text-ink">{r.actorEmail ?? "System"}</td>
                  <td className="text-sm text-ink">{label(r.action)}</td>
                  <td className="text-sm text-ink-soft">{r.entity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SuperAdminShell>
  );
}
