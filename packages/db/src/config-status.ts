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

/** An approval step nobody can act on: no one in the organisation holds that role. */
export interface StageWithoutHolder {
  role: string;
  /** The loan products whose chain contains the step. */
  products: string[];
  /** Whose applications reach it: "default" (everyone) or an applicant's role, e.g. "ceo". */
  appliesTo: string[];
}

export interface ConfigurationStatus {
  productsCount: number;
  pipelinesCount: number;
  productsWithoutPipeline: ProductWithoutPipeline[];
  productsMissingRateIndex: ProductWithoutPipeline[];
  /** Steps in an approval chain that no one holds the role for, so a loan reaching them would wait forever. */
  stagesWithoutHolder: StageWithoutHolder[];
  usersCount: number;
}

export async function configurationStatus(
  tx: Tx, tenantId: string,
): Promise<ConfigurationStatus> {
  const [productRow] = await tx`
    SELECT count(*)::int AS n FROM loan_products WHERE tenant_id = ${tenantId} AND active = true`;
  const [pipelineRow] = await tx`
    SELECT count(*)::int AS n FROM approval_pipelines p
    WHERE p.tenant_id = ${tenantId}
      AND EXISTS (SELECT 1 FROM approval_stages s WHERE s.pipeline_id = p.id AND s.retired_at IS NULL)`;

  const withoutPipeline = await tx`
    SELECT lp.id, lp.name FROM loan_products lp
    WHERE lp.tenant_id = ${tenantId} AND lp.active = true
      AND NOT EXISTS (
        SELECT 1 FROM approval_pipelines p
        JOIN approval_stages s ON s.pipeline_id = p.id AND s.retired_at IS NULL
        WHERE p.tenant_id = lp.tenant_id AND p.loan_product_id = lp.id
      )
    ORDER BY lp.name`;

  const missingRate = await tx`
    SELECT id, name FROM loan_products
    WHERE tenant_id = ${tenantId} AND active = true
      AND interest_applies = true AND rate_mode = 'index' AND rate_index_id IS NULL
    ORDER BY name`;

  const unstaffed = await tx`
    SELECT s.approver_role AS role,
           array_agg(DISTINCT lp.name ORDER BY lp.name) AS products,
           array_agg(DISTINCT p.applies_to ORDER BY p.applies_to) AS applies_to
    FROM approval_stages s
    JOIN approval_pipelines p ON p.id = s.pipeline_id
    JOIN loan_products lp ON lp.id = p.loan_product_id AND lp.active = true
    WHERE s.tenant_id = ${tenantId} AND s.retired_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id = s.tenant_id AND m.role = s.approver_role)
    GROUP BY s.approver_role
    ORDER BY s.approver_role`;

  const [userRow] = await tx`
    SELECT count(*)::int AS n FROM memberships WHERE tenant_id = ${tenantId}`;

  return {
    productsCount: Number(productRow?.n ?? 0),
    pipelinesCount: Number(pipelineRow?.n ?? 0),
    productsWithoutPipeline: withoutPipeline.map((r) => ({ id: r.id as string, name: r.name as string })),
    productsMissingRateIndex: missingRate.map((r) => ({ id: r.id as string, name: r.name as string })),
    stagesWithoutHolder: unstaffed.map((r) => ({ role: r.role as string, products: r.products as string[], appliesTo: r.applies_to as string[] })),
    usersCount: Number(userRow?.n ?? 0),
  };
}
