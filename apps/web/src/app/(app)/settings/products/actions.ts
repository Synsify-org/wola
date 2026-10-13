"use server";
// Create / edit / switch off loan products. Pricing and eligibility policy, so
// only PRODUCT_EDIT_ROLES may call these (the pages hide the controls from
// everyone else, but this is the real gate).
//
// A change here only shapes NEW applications: applications freeze their rate
// and eligibility at submission and loans freeze theirs at approval.
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/guard";
import { audit, createProduct, updateProduct, setProductActive, getProductAdmin } from "@wola/db";
import type { ProductConfigInput } from "@wola/engine";
import { PRODUCT_EDIT_ROLES } from "@/lib/permissions";

export type ProductActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const DENIED = "Only the CFO or an administrator can change loan products.";

function refresh() {
  revalidatePath("/settings/products");
  revalidatePath("/settings/routing");
  revalidatePath("/apply");
}

export async function createProductAction(
  input: ProductConfigInput,
  copyRoutingFrom: string | null,
): Promise<ProductActionResult> {
  return requireSession(async (tx, ctx) => {
    if (!PRODUCT_EDIT_ROLES.includes(ctx.role)) return { ok: false, error: DENIED };
    const res = await createProduct(tx, { tenantId: ctx.tenantId, input, copyRoutingFrom });
    if (!res.ok) return res;
    await audit(tx, {
      tenantId: ctx.tenantId, actorId: ctx.userId, action: "product.create",
      entity: "loan_product", entityId: res.id, after: { ...input, copyRoutingFrom },
    });
    refresh();
    return res;
  });
}

export async function updateProductAction(
  id: string,
  input: ProductConfigInput,
): Promise<ProductActionResult> {
  return requireSession(async (tx, ctx) => {
    if (!PRODUCT_EDIT_ROLES.includes(ctx.role)) return { ok: false, error: DENIED };
    const before = await getProductAdmin(tx, id);
    if (!before) return { ok: false, error: "Product not found." };
    const res = await updateProduct(tx, { tenantId: ctx.tenantId, id, input });
    if (!res.ok) return res;
    await audit(tx, {
      tenantId: ctx.tenantId, actorId: ctx.userId, action: "product.update",
      entity: "loan_product", entityId: id,
      before: { ...before, applications: undefined, inReview: undefined, activeLoans: undefined, chain: undefined },
      after: input,
    });
    refresh();
    return res;
  });
}

export async function setProductActiveAction(
  id: string,
  active: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return requireSession(async (tx, ctx) => {
    if (!PRODUCT_EDIT_ROLES.includes(ctx.role)) return { ok: false, error: DENIED };
    const res = await setProductActive(tx, { tenantId: ctx.tenantId, id, active });
    if (!res.ok) return res;
    await audit(tx, {
      tenantId: ctx.tenantId, actorId: ctx.userId,
      action: active ? "product.activate" : "product.deactivate",
      entity: "loan_product", entityId: id,
    });
    refresh();
    return { ok: true };
  });
}
