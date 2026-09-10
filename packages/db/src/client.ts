// packages/db/src/client.ts — the ONLY way application code touches the DB.
//
// Rule: no query runs outside tenantTx() except tenant resolution itself.
// tenantTx opens a transaction and sets app.tenant_id as a TRANSACTION-LOCAL
// setting (set_config(..., true)), so the context can never leak across
// pooled connections. RLS policies key off current_tenant_id().

import postgres from "postgres";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export * from "./employee-financials";
export * from "./schedules";
export * from "./approvals";
export * from "./loans";


export function makeDb(url = process.env.DATABASE_URL!): Sql {
  // Connects as wola_app: no BYPASSRLS, no DDL, no audit UPDATE/DELETE.
  // idle_timeout releases connections that hot-reload orphaned pools would
  // otherwise hold open until Postgres's max_connections is exhausted (the
  // recurring dev-mode AggregateError at the first query). connect_timeout
  // makes a genuinely-down database fail fast with a clear error instead of
  // hanging. max is modest for local dev.
  // prepare: false — required when DATABASE_URL points at a transaction-mode
  // pgbouncer pooler (e.g. Supabase's Supavisor on :6543): each query can land
  // on a different backend connection, so a cached server-side prepared
  // statement handle from a prior query is invalid. Harmless against a direct
  // (non-pooled) connection too, just skips a query-plan cache.
  return postgres(url, {
    max: 10,
    idle_timeout: 20,     // seconds; drop idle connections
    connect_timeout: 10,  // seconds; fail fast if DB unreachable
    prepare: false,
  });
}

/** Resolve a subdomain slug to a live tenant. Cache in Redis in the app layer. */
export async function resolveTenant(sql: Sql, slug: string) {
  const rows = await sql`
    SELECT id, slug, name, status, plan, currency, timezone, settings
    FROM tenants WHERE slug = ${slug} AND status IN ('trial','active')`;
  return rows[0] ?? null;
}

/** Run `fn` inside a transaction scoped to one tenant. */
export async function tenantTx<T>(
  sql: Sql,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx as Tx);
  }) as Promise<T>;
}

/** Append-only audit write. Call inside the same tenantTx as the mutation. */
export async function audit(
  tx: Tx,
  e: { tenantId: string; actorId?: string | null; action: string;
       entity: string; entityId?: string; before?: unknown; after?: unknown },
) {
  await tx`INSERT INTO audit_log (tenant_id, actor_id, action, entity, entity_id, before, after)
    VALUES (${e.tenantId}, ${e.actorId ?? null}, ${e.action}, ${e.entity},
            ${e.entityId ?? null}, ${tx.json((e.before ?? null) as never)}, ${tx.json((e.after ?? null) as never)})`;
}
export * from "./metrics";
export * from "./product-rules";
export * from "./email";
export * from "./auth";
export * from "./rate-indices";
export * from "./reconciliation";
export * from "./hr-register";
export * from "./employee-position";
export * from "./config-status";
export * from "./notifications";
export * from "./invitations";
export * from "./super-admin";