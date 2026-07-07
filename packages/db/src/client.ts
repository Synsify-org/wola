// packages/db/src/client.ts — the ONLY way application code touches the DB.
//
// Rule: no query runs outside tenantTx() except tenant resolution itself.
// tenantTx opens a transaction and sets app.tenant_id as a TRANSACTION-LOCAL
// setting (set_config(..., true)), so the context can never leak across
// pooled connections. RLS policies key off current_tenant_id().

import postgres from "postgres";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export function makeDb(url = process.env.DATABASE_URL!): Sql {
  // Connects as wola_app: no BYPASSRLS, no DDL, no audit UPDATE/DELETE.
  return postgres(url, { max: 10 });
}

/** Resolve a subdomain slug to a live tenant. Cache in Redis in the app layer. */
export async function resolveTenant(sql: Sql, slug: string) {
  const rows = await sql`
    SELECT id, slug, name, status, plan, currency, timezone
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
            ${e.entityId ?? null}, ${tx.json(e.before ?? null)}, ${tx.json(e.after ?? null)})`;
}
