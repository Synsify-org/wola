// packages/db/src/config-status.ts
// The Administration hero (architecture doc §6.2): "is this tenant configured
// correctly and running." A readiness checklist, not a lending view.
//
// The doc also names "disbursement channels" as a checklist item. There is no
// disbursement-channel/bank concept anywhere in the schema yet — deliberately
// not faked here with a fabricated done/not-done state. See TASKS.md.
import type { Tx } from "./client";

export interface ProductWithoutPipeline {
  id: string;
  name: string;
}

export interface ConfigurationStatus {
  productsCount: number;
  pipelinesCount: number;
  productsWithoutPipeline: ProductWithoutPipeline[];
  productsMissingRateIndex: ProductWithoutPipeline[];
  usersCount: number;
}

export async function configurationStatus(
  tx: Tx, tenantId: string,
): Promise<ConfigurationStatus> {
  const [productRow] = await tx`
    SELECT count(*)::int AS n FROM loan_products WHERE tenant_id = ${tenantId} AND active = true`;
  const [pipelineRow] = await tx`
    SELECT count(*)::int AS n FROM approval_pipelines WHERE tenant_id = ${tenantId}`;

  const withoutPipeline = await tx`
    SELECT lp.id, lp.name FROM loan_products lp
    WHERE lp.tenant_id = ${tenantId} AND lp.active = true
      AND NOT EXISTS (
        SELECT 1 FROM approval_pipelines p
        WHERE p.tenant_id = lp.tenant_id AND p.loan_product_id = lp.id
      )
    ORDER BY lp.name`;

  const missingRate = await tx`
    SELECT id, name FROM loan_products
    WHERE tenant_id = ${tenantId} AND active = true
      AND interest_applies = true AND rate_index_id IS NULL
    ORDER BY name`;

  const [userRow] = await tx`
    SELECT count(*)::int AS n FROM memberships WHERE tenant_id = ${tenantId}`;

  return {
    productsCount: Number(productRow?.n ?? 0),
    pipelinesCount: Number(pipelineRow?.n ?? 0),
    productsWithoutPipeline: withoutPipeline.map((r) => ({ id: r.id as string, name: r.name as string })),
    productsMissingRateIndex: missingRate.map((r) => ({ id: r.id as string, name: r.name as string })),
    usersCount: Number(userRow?.n ?? 0),
  };
}
