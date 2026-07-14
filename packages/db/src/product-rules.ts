// packages/db/src/product-rules.ts
// Loads each product configuration for the tenant, so the eligibility engine
// can compute caps without knowing what any product is called.
import type { ProductRules } from "@wola/engine";
import type { Tx } from "./client";

export interface ProductWithRules extends ProductRules {
  kind: string;
}

/** Every active product for the tenant, with its rules and exclusions.
 *  RLS scopes this to the tenant automatically. */
export async function loadProductRules(tx: Tx): Promise<ProductWithRules[]> {
  const rows = await tx`
    SELECT id, name, kind,
           cap_method, cap_basis, cap_multiple,
           takehome_factor, takehome_multiplier,
           max_tenor_months, interest_applies,
           requires_post_probation, blocked_by_final_warning,
           requires_external_declaration
    FROM loan_products
    WHERE active = true
    ORDER BY name`;

  const exclusions = await tx`
    SELECT loan_product_id, excludes_product_id FROM product_exclusions`;

  const byProduct = new Map<string, string[]>();
  for (const e of exclusions) {
    const k = e.loan_product_id as string;
    if (!byProduct.has(k)) byProduct.set(k, []);
    byProduct.get(k)!.push(e.excludes_product_id as string);
  }

  return rows.map((r) => ({
    productId: r.id as string,
    name: r.name as string,
    kind: r.kind as string,
    capMethod: r.cap_method as ProductRules["capMethod"],
    capBasis: r.cap_basis as ProductRules["capBasis"],
    capMultiple: r.cap_multiple === null ? null : Number(r.cap_multiple),
    takehomeFactor:
      r.takehome_factor === null ? null : Number(r.takehome_factor),
    takehomeMultiplier:
      r.takehome_multiplier === null ? null : Number(r.takehome_multiplier),
    maxTenorMonths: Number(r.max_tenor_months),
    interestApplies: r.interest_applies as boolean,
    requiresPostProbation: r.requires_post_probation as boolean,
    blockedByFinalWarning: r.blocked_by_final_warning as boolean,
    requiresExternalDeclaration: r.requires_external_declaration as boolean,
    excludes: byProduct.get(r.id as string) ?? [],
  }));
}
