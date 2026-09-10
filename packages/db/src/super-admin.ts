// packages/db/src/super-admin.ts
// Platform-operator identity + cross-tenant oversight (spec §6.1). Reuses
// the same global users/password system every tenant login uses — see
// migration 0014's header; no separate hardcoded credentials.
//
// Cross-tenant aggregates below deliberately use ONLY the normal wola_app
// connection, looping per tenant through tenantTx — never a bypass-RLS role.
// DECISIONS.md is explicit that wola_app having no BYPASSRLS is what makes a
// query bug harmless; a "just for the admin dashboard" elevated credential
// would undo that guarantee for the one surface with the most reach across
// every customer's data. Trade-off: N queries for N tenants, not one. Fine
// at the tenant counts this platform is actually at — same acknowledged
// shape as inboxFor()'s per-application loop (see its own N+1 note).
import { verifyPassword, isRateLimited, recordLoginAttempt } from "./auth";
import { tenantTx, type Sql } from "./client";

export type SuperAdminAuthResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "rate_limited" };

/** Authenticate a platform operator. Mirrors login()'s shape in
 *  apps/web/src/lib/auth.ts (uniform-timing dummy hash, same reason —
 *  defeats user enumeration by response time) but additionally requires an
 *  active super_admins row, not just a valid password. */
export async function authenticateSuperAdmin(
  sql: Sql, email: string, password: string, ip: string,
): Promise<SuperAdminAuthResult> {
  if (await isRateLimited(sql, email, ip)) return { ok: false, reason: "rate_limited" };

  const [row] = await sql`
    SELECT u.id, u.password_hash FROM users u
    JOIN super_admins sa ON sa.user_id = u.id
    WHERE u.email = ${email} AND u.status = 'active' AND sa.status = 'active'`;

  const dummyHash = "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const ok = await verifyPassword((row?.password_hash as string) ?? dummyHash, password);
  await recordLoginAttempt(sql, email, ip);

  if (!row || !row.password_hash || !ok) return { ok: false, reason: "invalid" };
  return { ok: true, userId: row.id as string };
}

export interface PlatformOverview {
  tenantCount: number;
  activeTenantCount: number;
  totalActiveLoans: number;
  totalPrincipalDisbursed: number;
  totalOutstanding: number;
}

/** Cross-tenant totals for the Overview tab. */
export async function platformOverview(sql: Sql): Promise<PlatformOverview> {
  const tenants = await sql`SELECT id, status FROM tenants`;

  let totalActiveLoans = 0;
  let totalPrincipalDisbursed = 0;
  let totalOutstanding = 0;

  for (const t of tenants) {
    const [row] = await tenantTx(sql, t.id as string, (tx) => tx`
      SELECT count(*)::int AS n, COALESCE(sum(l.principal), 0) AS principal,
             COALESCE(sum(GREATEST(l.principal - COALESCE(
               (SELECT sum((r.allocation->>'principal')::numeric) FROM repayments r WHERE r.loan_id = l.id),
               0
             ), 0)), 0) AS outstanding
      FROM loans l WHERE l.status = 'active'`);
    totalActiveLoans += Number(row.n);
    totalPrincipalDisbursed += Number(row.principal);
    totalOutstanding += Number(row.outstanding);
  }

  return {
    tenantCount: tenants.length,
    activeTenantCount: tenants.filter((t) => t.status === "active").length,
    totalActiveLoans, totalPrincipalDisbursed, totalOutstanding,
  };
}

export interface TenantRegistryRow {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: string;
  createdAt: string;
  activeLoans: number;
  principalDisbursed: number;
}

/** Every onboarded tenant with a drill-down-worthy summary, for the Tenant
 *  Registry tab. `tenants` itself isn't RLS-protected (a plain lookup table,
 *  same as resolveTenant() already reads it), only the per-tenant loan
 *  aggregates need the tenantTx loop. */
export async function tenantRegistry(sql: Sql): Promise<TenantRegistryRow[]> {
  const tenants = await sql`
    SELECT id, slug, name, plan, status, created_at FROM tenants ORDER BY created_at DESC`;

  const rows: TenantRegistryRow[] = [];
  for (const t of tenants) {
    const [book] = await tenantTx(sql, t.id as string, (tx) => tx`
      SELECT count(*)::int AS n, COALESCE(sum(principal), 0) AS principal
      FROM loans WHERE status = 'active'`);
    rows.push({
      id: t.id as string,
      slug: t.slug as string,
      name: t.name as string,
      plan: t.plan as string,
      status: t.status as string,
      createdAt: new Date(t.created_at as string).toISOString(),
      activeLoans: Number(book.n),
      principalDisbursed: Number(book.principal),
    });
  }
  return rows;
}

export interface CrossTenantAuditRow {
  tenantName: string;
  tenantSlug: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorEmail: string | null;
  at: string;
}

/** Recent activity across every tenant, merged and sorted, for the Audit
 *  Logs tab. Capped per-tenant AND overall so one very active tenant can't
 *  starve the view of everyone else's rows. */
export async function crossTenantAuditLog(
  sql: Sql, perTenantLimit = 10, totalLimit = 100,
): Promise<CrossTenantAuditRow[]> {
  const tenants = await sql`SELECT id, slug, name FROM tenants`;

  const all: CrossTenantAuditRow[] = [];
  for (const t of tenants) {
    const rows = await tenantTx(sql, t.id as string, (tx) => tx`
      SELECT a.action, a.entity, a.entity_id, a.at, u.email AS actor_email
      FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      ORDER BY a.at DESC LIMIT ${perTenantLimit}`);
    for (const r of rows) {
      all.push({
        tenantName: t.name as string,
        tenantSlug: t.slug as string,
        action: r.action as string,
        entity: r.entity as string,
        entityId: r.entity_id as string | null,
        actorEmail: r.actor_email as string | null,
        at: new Date(r.at as string).toISOString(),
      });
    }
  }

  all.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return all.slice(0, totalLimit);
}
