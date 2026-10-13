// packages/db/src/routing-admin.ts
// Administration of approval routing: who approves each product, in what
// order. A chain belongs to a product and to an applicant group: "default"
// (everyone) or a role name (e.g. "ceo" — the CEO applying can't approve
// themselves, so they may have their own chain).
//
// Stages are VERSIONED, never edited or deleted when the chain changes (see
// 0020_stage_versioning.sql): approvals point at stages, and history must keep
// saying which role really decided. A changed chain retires the old stages and
// inserts new ones; loadPipelines(asOf application) resolves each application
// to the chain live when it was submitted.
//
// Re-routing is refused while applications for the product are in review —
// they were submitted under the old chain and have decisions recorded against
// it, so silently swapping the chain under them would strand or re-ask
// approvals. Tweaks that keep the same approvers in the same order (time
// limits, delegation) are always allowed.
import { validateStages, sameChain, type StageInput } from "@wola/engine";
import type { Tx } from "./client";

export interface RoutingStage {
  id: string;
  role: string;
  slaHours: number | null;
  allowDelegation: boolean;
}

export interface RoutingChain {
  appliesTo: string;
  stages: RoutingStage[];
}

export interface ProductRouting {
  productId: string;
  productName: string;
  active: boolean;
  /** Applications submitted or in review for this product right now. */
  inReview: number;
  chains: RoutingChain[];
}

/** Live chains for every product (switched-off included), 'default' first. */
export async function listRouting(tx: Tx): Promise<ProductRouting[]> {
  const products = await tx`
    SELECT lp.id, lp.name, lp.active,
      (SELECT count(*) FROM loan_applications la
         WHERE la.loan_product_id = lp.id AND la.status IN ('submitted','in_review')) AS in_review
    FROM loan_products lp ORDER BY lp.active DESC, lp.name`;
  const rows = await tx`
    SELECT p.loan_product_id, p.applies_to, s.id, s.position, s.approver_role, s.sla_hours, s.allow_delegation
    FROM approval_pipelines p JOIN approval_stages s ON s.pipeline_id = p.id
    WHERE s.retired_at IS NULL
    ORDER BY p.loan_product_id, (p.applies_to <> 'default'), p.applies_to, s.position`;

  const byProduct = new Map<string, RoutingChain[]>();
  for (const r of rows) {
    const pid = r.loan_product_id as string;
    if (!byProduct.has(pid)) byProduct.set(pid, []);
    const chains = byProduct.get(pid)!;
    let chain = chains.find((c) => c.appliesTo === r.applies_to);
    if (!chain) { chain = { appliesTo: r.applies_to as string, stages: [] }; chains.push(chain); }
    chain.stages.push({
      id: r.id as string,
      role: r.approver_role as string,
      slaHours: r.sla_hours as number | null,
      allowDelegation: r.allow_delegation as boolean,
    });
  }
  return products.map((p) => ({
    productId: p.id as string,
    productName: p.name as string,
    active: p.active as boolean,
    inReview: Number(p.in_review),
    chains: byProduct.get(p.id as string) ?? [],
  }));
}

export type SaveChainResult =
  | { ok: true; changed: "none" | "tweaked" | "rerouted" | "removed" }
  | { ok: false; error: string };

/** Replace the chain for (product, appliesTo). An empty list removes an
 *  exception chain (applicants fall back to the standard one); the standard
 *  chain itself can never be empty. */
export async function saveChain(
  tx: Tx,
  args: { tenantId: string; productId: string; appliesTo: string; stages: StageInput[] },
): Promise<SaveChainResult> {
  const { tenantId, productId, appliesTo, stages } = args;
  const valid = validateStages(stages, { required: appliesTo === "default" });
  if (!valid.ok) return valid;

  const [prod] = await tx`SELECT id FROM loan_products WHERE id = ${productId} AND tenant_id = ${tenantId}`;
  if (!prod) return { ok: false, error: "Product not found." };

  // Serialise concurrent edits of one product's routing.
  await tx`SELECT id FROM loan_products WHERE id = ${productId} FOR UPDATE`;

  let [pipeline] = await tx`
    SELECT id FROM approval_pipelines
    WHERE tenant_id = ${tenantId} AND loan_product_id = ${productId} AND applies_to = ${appliesTo}`;
  if (!pipeline) {
    if (stages.length === 0) return { ok: true, changed: "none" };
    [pipeline] = await tx`
      INSERT INTO approval_pipelines (tenant_id, loan_product_id, applies_to)
      VALUES (${tenantId}, ${productId}, ${appliesTo}) RETURNING id`;
  }
  const pipelineId = pipeline.id as string;

  const live = await tx`
    SELECT id, approver_role AS role, sla_hours, allow_delegation
    FROM approval_stages
    WHERE pipeline_id = ${pipelineId} AND retired_at IS NULL
    ORDER BY position`;
  const current = live.map((s) => ({ id: s.id as string, role: s.role as string, slaHours: s.sla_hours as number | null, allowDelegation: s.allow_delegation as boolean }));

  if (sameChain(current, stages.map((s) => ({ role: s.role })))) {
    let touched = false;
    for (const [i, s] of stages.entries()) {
      if (current[i].slaHours !== s.slaHours || current[i].allowDelegation !== s.allowDelegation) {
        await tx`UPDATE approval_stages SET sla_hours = ${s.slaHours}, allow_delegation = ${s.allowDelegation}
                 WHERE id = ${current[i].id}`;
        touched = true;
      }
    }
    return { ok: true, changed: touched ? "tweaked" : "none" };
  }

  const [{ n }] = await tx`
    SELECT count(*)::int AS n FROM loan_applications
    WHERE loan_product_id = ${productId} AND status IN ('submitted','in_review')`;
  if (Number(n) > 0) {
    return {
      ok: false,
      error: `${n} application${n === 1 ? " is" : "s are"} still in review for this product, and they were submitted under the current approvers. Re-ordering or changing approvers is locked until they are decided. (Time limits and delegation can still be changed.)`,
    };
  }

  await tx`UPDATE approval_stages SET retired_at = now() WHERE pipeline_id = ${pipelineId} AND retired_at IS NULL`;
  for (const [i, s] of stages.entries()) {
    await tx`
      INSERT INTO approval_stages (tenant_id, pipeline_id, position, approver_role, sla_hours, allow_delegation)
      VALUES (${tenantId}, ${pipelineId}, ${i + 1}, ${s.role}, ${s.slaHours}, ${s.allowDelegation})`;
  }
  return { ok: true, changed: stages.length === 0 ? "removed" : "rerouted" };
}

/** Copy every live chain of one product onto another (used when creating a
 *  product "like" an existing one). The target must have no chains yet. */
export async function copyRouting(tx: Tx, tenantId: string, fromProductId: string, toProductId: string) {
  const chains = await tx`
    SELECT p.id, p.applies_to FROM approval_pipelines p
    WHERE p.tenant_id = ${tenantId} AND p.loan_product_id = ${fromProductId}`;
  for (const c of chains) {
    const stages = await tx`
      SELECT position, approver_role, sla_hours, allow_delegation FROM approval_stages
      WHERE pipeline_id = ${c.id as string} AND retired_at IS NULL ORDER BY position`;
    if (stages.length === 0) continue;
    const [np] = await tx`
      INSERT INTO approval_pipelines (tenant_id, loan_product_id, applies_to)
      VALUES (${tenantId}, ${toProductId}, ${c.applies_to as string}) RETURNING id`;
    for (const s of stages) {
      await tx`
        INSERT INTO approval_stages (tenant_id, pipeline_id, position, approver_role, sla_hours, allow_delegation)
        VALUES (${tenantId}, ${np.id as string}, ${s.position as number}, ${s.approver_role as string},
                ${s.sla_hours as number | null}, ${s.allow_delegation as boolean})`;
    }
  }
}
