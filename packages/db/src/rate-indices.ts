// packages/db/src/rate-indices.ts
// A rate index (e.g. BoU CBR) is TENANT DATA, never a literal in code — see
// resolveRate() in approvals.ts, which refuses to guess a rate and hard-fails
// final approval on any interest-bearing product with no rate_index_id set.
// This is the admin-facing counterpart: a way to actually set one, and to see
// which products are exposed to that failure before an approver hits it.
//
// rate_indices is a HISTORY table (UNIQUE on tenant_id, name, effective_from):
// setting a new value never mutates an old row, it inserts a new one and
// re-points every product that was on the previous value (or unset) to it.
// Past rates stay on the record for audit.
import type { Tx } from "./client";

export interface RateIndexView {
  id: string;
  name: string;
  currentValue: number;
  effectiveFrom: string;
  productsLinked: number;
}

/** The current (most recent by effective_from) row per index name for this
 *  tenant — what products actually reference today. */
export async function listCurrentRateIndices(
  tx: Tx, tenantId: string,
): Promise<RateIndexView[]> {
  const rows = await tx`
    SELECT DISTINCT ON (ri.name)
      ri.id, ri.name, ri.current_value, ri.effective_from,
      (SELECT count(*)::int FROM loan_products lp WHERE lp.rate_index_id = ri.id) AS products_linked
    FROM rate_indices ri
    WHERE ri.tenant_id = ${tenantId}
    ORDER BY ri.name, ri.effective_from DESC, ri.created_at DESC`;
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    currentValue: Number(r.current_value),
    effectiveFrom: String(r.effective_from),
    productsLinked: Number(r.products_linked),
  }));
}

export interface ProductMissingRate {
  id: string;
  name: string;
}

/** Active, interest-bearing products with no rate index at all. Any one of
 *  these will hard-fail resolveRate() the moment someone tries to finally
 *  approve a loan against it — surfaced here so setup can catch it before an
 *  approver does. */
export async function productsMissingRateIndex(
  tx: Tx, tenantId: string,
): Promise<ProductMissingRate[]> {
  const rows = await tx`
    SELECT id, name FROM loan_products
    WHERE tenant_id = ${tenantId} AND active = true
      AND interest_applies = true AND rate_index_id IS NULL
    ORDER BY name`;
  return rows.map((r) => ({ id: r.id as string, name: r.name as string }));
}

export interface SetRateIndexArgs {
  tenantId: string;
  name: string;
  value: number;
  effectiveFrom?: Date;
}

/** Record a new value for `name`, effective today (or a given date), and
 *  re-point every interest-bearing product currently on the PREVIOUS value
 *  for this name — or with no index set yet — to the new one. Setting the
 *  same name twice on the same day corrects that day's entry in place rather
 *  than erroring on the unique constraint. */
export async function setRateIndex(
  tx: Tx, args: SetRateIndexArgs,
): Promise<{ id: string; productsRepointed: number }> {
  const name = args.name.trim();
  if (!name) throw new Error("Rate index name is required.");
  if (!(args.value >= 0)) throw new Error("Rate must be zero or positive.");

  const [prev] = await tx`
    SELECT id FROM rate_indices
    WHERE tenant_id = ${args.tenantId} AND name = ${name}
    ORDER BY effective_from DESC, created_at DESC LIMIT 1`;

  const [row] = await tx`
    INSERT INTO rate_indices (tenant_id, name, current_value, effective_from)
    VALUES (${args.tenantId}, ${name}, ${args.value}, ${args.effectiveFrom ?? new Date()})
    ON CONFLICT (tenant_id, name, effective_from)
    DO UPDATE SET current_value = EXCLUDED.current_value
    RETURNING id`;
  const newId = row.id as string;

  const repointed = await tx`
    UPDATE loan_products
    SET rate_index_id = ${newId}, updated_at = now()
    WHERE tenant_id = ${args.tenantId} AND interest_applies = true
      AND rate_index_id IS NOT DISTINCT FROM ${prev?.id ?? null}
      AND rate_index_id IS DISTINCT FROM ${newId}
    RETURNING id`;

  return { id: newId, productsRepointed: repointed.length };
}
