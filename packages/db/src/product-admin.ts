// packages/db/src/product-admin.ts
// Administration of loan products: list, create, edit, switch on/off.
//
// A product is TENANT CONFIG (see 0008_product_rules.sql) — editing one never
// touches what is already decided. Applications freeze their rate and
// eligibility at submission (eligibility_snapshot) and loans freeze their
// rate and schedule at approval, so a change here only shapes NEW
// applications. Products are never deleted: applications, loans and the audit
// trail point at them (and applications cascade on delete). Switching one off
// hides it from the apply form instead.
import { effectiveAnnualRate, validateProductConfig, type ProductConfigInput } from "@wola/engine";
import type { Tx } from "./client";
import { copyRouting } from "./routing-admin";

export interface ProductAdminRow extends ProductConfigInput {
  id: string;
  active: boolean;
  /** Names of the excluded products, for display. */
  excludesNames: string[];
  applications: number;
  inReview: number;
  activeLoans: number;
  /** Approver roles on the live standard chain, in order (empty = none set up). */
  chain: string[];
  /** The rate an application submitted now would be quoted (fraction), or null. */
  currentRate: number | null;
}

type Row = Record<string, unknown>;

function toRow(r: Row, excl: Map<string, { id: string; name: string }[]>, chain: Map<string, string[]>): ProductAdminRow {
  const id = r.id as string;
  const ex = excl.get(id) ?? [];
  return {
    id,
    name: r.name as string,
    kind: r.kind as ProductConfigInput["kind"],
    active: r.active as boolean,
    capMethod: r.cap_method as ProductConfigInput["capMethod"],
    capBasis: r.cap_basis as ProductConfigInput["capBasis"],
    capMultiple: r.cap_multiple === null ? null : Number(r.cap_multiple),
    takehomeFactor: r.takehome_factor === null ? null : Number(r.takehome_factor),
    takehomeMultiplier: r.takehome_multiplier === null ? null : Number(r.takehome_multiplier),
    maxTenorMonths: Number(r.max_tenor_months),
    interestApplies: r.interest_applies as boolean,
    rateMode: r.rate_mode as ProductConfigInput["rateMode"],
    rateIndexName: (r.rate_index_name as string | null) ?? null,
    rateMargin: Number(r.rate_margin),
    fixedRate: r.fixed_rate === null ? null : Number(r.fixed_rate),
    currentRate: effectiveAnnualRate({
      interestApplies: r.interest_applies as boolean,
      rateMode: r.rate_mode as "index" | "fixed",
      fixedRate: r.fixed_rate === null ? null : Number(r.fixed_rate),
      rateMargin: Number(r.rate_margin),
      indexValue: r.rate_index_value === null || r.rate_index_value === undefined ? null : Number(r.rate_index_value),
    }),
    requiresPostProbation: r.requires_post_probation as boolean,
    blockedByFinalWarning: r.blocked_by_final_warning as boolean,
    requiresExternalDeclaration: r.requires_external_declaration as boolean,
    excludes: ex.map((x) => x.id),
    excludesNames: ex.map((x) => x.name),
    applications: Number(r.applications ?? 0),
    inReview: Number(r.in_review ?? 0),
    activeLoans: Number(r.active_loans ?? 0),
    chain: chain.get(id) ?? [],
  };
}

/** Every product (switched-off ones too), with usage counts and its standard
 *  approval chain. RLS scopes to the tenant. */
export async function listProductsAdmin(tx: Tx): Promise<ProductAdminRow[]> {
  const rows = await tx`
    SELECT lp.*, ri.name AS rate_index_name, ri.current_value AS rate_index_value,
      (SELECT count(*) FROM loan_applications la WHERE la.loan_product_id = lp.id) AS applications,
      (SELECT count(*) FROM loan_applications la
         WHERE la.loan_product_id = lp.id AND la.status IN ('submitted','in_review')) AS in_review,
      (SELECT count(*) FROM loans l JOIN loan_applications la ON la.id = l.application_id
         WHERE la.loan_product_id = lp.id AND l.status = 'active') AS active_loans
    FROM loan_products lp
    LEFT JOIN rate_indices ri ON ri.id = lp.rate_index_id
    ORDER BY lp.active DESC, lp.name`;

  const excl = new Map<string, { id: string; name: string }[]>();
  for (const e of await tx`
    SELECT pe.loan_product_id, pe.excludes_product_id, lp.name
    FROM product_exclusions pe JOIN loan_products lp ON lp.id = pe.excludes_product_id
    ORDER BY lp.name`) {
    const k = e.loan_product_id as string;
    if (!excl.has(k)) excl.set(k, []);
    excl.get(k)!.push({ id: e.excludes_product_id as string, name: e.name as string });
  }

  const chain = new Map<string, string[]>();
  for (const c of await tx`
    SELECT p.loan_product_id, s.approver_role
    FROM approval_pipelines p JOIN approval_stages s ON s.pipeline_id = p.id
    WHERE p.applies_to = 'default' AND s.retired_at IS NULL
    ORDER BY p.loan_product_id, s.position`) {
    const k = c.loan_product_id as string;
    if (!chain.has(k)) chain.set(k, []);
    chain.get(k)!.push(c.approver_role as string);
  }

  return rows.map((r) => toRow(r, excl, chain));
}

export async function getProductAdmin(tx: Tx, id: string): Promise<ProductAdminRow | null> {
  return (await listProductsAdmin(tx)).find((p) => p.id === id) ?? null;
}

async function rateIndexIdFor(tx: Tx, tenantId: string, name: string | null): Promise<string | null> {
  if (!name) return null;
  const [r] = await tx`
    SELECT id FROM rate_indices
    WHERE tenant_id = ${tenantId} AND name = ${name}
    ORDER BY effective_from DESC, created_at DESC LIMIT 1`;
  return (r?.id as string | undefined) ?? null;
}

/** Make exclusions symmetric (MUA bars car + development together, in both
 *  directions): replace every row touching `productId`, then mirror. */
async function setExclusions(tx: Tx, tenantId: string, productId: string, excludes: string[]) {
  await tx`DELETE FROM product_exclusions
           WHERE tenant_id = ${tenantId}
             AND (loan_product_id = ${productId} OR excludes_product_id = ${productId})`;
  for (const other of [...new Set(excludes)]) {
    await tx`INSERT INTO product_exclusions (tenant_id, loan_product_id, excludes_product_id)
             VALUES (${tenantId}, ${productId}, ${other}), (${tenantId}, ${other}, ${productId})`;
  }
}

export type ProductWriteResult =
  | { ok: true; id: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Only index-priced, interest-bearing products link to a rate index. */
const linksIndex = (i: ProductConfigInput) => i.interestApplies && i.rateMode === "index";

async function checkRateIndex(tx: Tx, tenantId: string, input: ProductConfigInput): Promise<string | null> {
  if (!linksIndex(input)) return null;
  const id = await rateIndexIdFor(tx, tenantId, input.rateIndexName);
  return id ? null : "That rate doesn't exist. Set it under Settings → Rates first.";
}

async function checkExcludes(tx: Tx, tenantId: string, excludes: string[]): Promise<string | null> {
  if (excludes.length === 0) return null;
  const found = await tx`SELECT id FROM loan_products WHERE tenant_id = ${tenantId} AND id = ANY(${excludes}::uuid[])`;
  return found.length === new Set(excludes).size ? null : "One of the excluded products no longer exists.";
}

const isUniqueViolation = (e: unknown) => (e as { code?: string }).code === "23505";

export async function createProduct(
  tx: Tx,
  args: { tenantId: string; input: ProductConfigInput; copyRoutingFrom?: string | null },
): Promise<ProductWriteResult> {
  const { tenantId, input } = args;
  const fe = validateProductConfig(input);
  if (Object.keys(fe).length) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fe as Record<string, string> };
  const rateErr = await checkRateIndex(tx, tenantId, input);
  if (rateErr) return { ok: false, error: rateErr, fieldErrors: { rateIndexName: rateErr } };
  const exErr = await checkExcludes(tx, tenantId, input.excludes);
  if (exErr) return { ok: false, error: exErr };

  let id: string;
  const rateId = linksIndex(input) ? await rateIndexIdFor(tx, tenantId, input.rateIndexName) : null;
  // A savepoint, so a duplicate-name violation rolls back just this statement
  // instead of poisoning the surrounding transaction.
  try {
    const [row] = await tx.savepoint((sp) => sp`
      INSERT INTO loan_products
        (tenant_id, name, kind, cap_method, cap_basis, cap_multiple, takehome_factor, takehome_multiplier,
         max_tenor_months, interest_applies, rate_index_id, rate_mode, rate_margin, fixed_rate,
         requires_post_probation, blocked_by_final_warning, requires_external_declaration)
      VALUES
        (${tenantId}, ${input.name.trim()}, ${input.kind}, ${input.capMethod}, ${input.capBasis},
         ${input.capMethod === "salary_multiple" ? input.capMultiple : null},
         ${input.capMethod === "takehome_factor" ? input.takehomeFactor : null},
         ${input.capMethod === "takehome_factor" ? input.takehomeMultiplier : null},
         ${input.maxTenorMonths}, ${input.interestApplies},
         ${rateId}, ${input.rateMode}, ${linksIndex(input) ? input.rateMargin : 0},
         ${input.interestApplies && input.rateMode === "fixed" ? input.fixedRate : null},
         ${input.requiresPostProbation}, ${input.blockedByFinalWarning}, ${input.requiresExternalDeclaration})
      RETURNING id`);
    id = row.id as string;
  } catch (e) {
    if (isUniqueViolation(e)) {
      return { ok: false, error: "You already have a product with that name.", fieldErrors: { name: "You already have a product with that name." } };
    }
    throw e;
  }

  await setExclusions(tx, tenantId, id, input.excludes);
  if (args.copyRoutingFrom) await copyRouting(tx, tenantId, args.copyRoutingFrom, id);
  return { ok: true, id };
}

export async function updateProduct(
  tx: Tx,
  args: { tenantId: string; id: string; input: ProductConfigInput },
): Promise<ProductWriteResult> {
  const { tenantId, id, input } = args;
  const fe = validateProductConfig(input, id);
  if (Object.keys(fe).length) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fe as Record<string, string> };
  const rateErr = await checkRateIndex(tx, tenantId, input);
  if (rateErr) return { ok: false, error: rateErr, fieldErrors: { rateIndexName: rateErr } };
  const exErr = await checkExcludes(tx, tenantId, input.excludes);
  if (exErr) return { ok: false, error: exErr };

  const rateId = linksIndex(input) ? await rateIndexIdFor(tx, tenantId, input.rateIndexName) : null;
  try {
    const res = await tx.savepoint((sp) => sp`
      UPDATE loan_products SET
        name = ${input.name.trim()}, kind = ${input.kind},
        cap_method = ${input.capMethod}, cap_basis = ${input.capBasis},
        cap_multiple = ${input.capMethod === "salary_multiple" ? input.capMultiple : null},
        takehome_factor = ${input.capMethod === "takehome_factor" ? input.takehomeFactor : null},
        takehome_multiplier = ${input.capMethod === "takehome_factor" ? input.takehomeMultiplier : null},
        max_tenor_months = ${input.maxTenorMonths}, interest_applies = ${input.interestApplies},
        rate_index_id = ${rateId}, rate_mode = ${input.rateMode},
        rate_margin = ${linksIndex(input) ? input.rateMargin : 0},
        fixed_rate = ${input.interestApplies && input.rateMode === "fixed" ? input.fixedRate : null},
        requires_post_probation = ${input.requiresPostProbation},
        blocked_by_final_warning = ${input.blockedByFinalWarning},
        requires_external_declaration = ${input.requiresExternalDeclaration},
        updated_at = now()
      WHERE id = ${id} AND tenant_id = ${tenantId}
      RETURNING id`);
    if (res.length === 0) return { ok: false, error: "Product not found." };
  } catch (e) {
    if (isUniqueViolation(e)) {
      return { ok: false, error: "You already have a product with that name.", fieldErrors: { name: "You already have a product with that name." } };
    }
    throw e;
  }

  await setExclusions(tx, tenantId, id, input.excludes);
  return { ok: true, id };
}

/** Switch a product on or off. Off hides it from the apply form; applications
 *  already in review carry on and finish normally. */
export async function setProductActive(
  tx: Tx, args: { tenantId: string; id: string; active: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await tx`
    UPDATE loan_products SET active = ${args.active}, updated_at = now()
    WHERE id = ${args.id} AND tenant_id = ${args.tenantId} RETURNING id`;
  return res.length ? { ok: true } : { ok: false, error: "Product not found." };
}
