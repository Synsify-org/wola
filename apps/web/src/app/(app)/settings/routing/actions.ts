"use server";
// Change who approves a loan product. Administrators only (ROUTING_EDIT_ROLES):
// the CFO and CEO sit on the chains, so they can't rewire their own stage.
// The DB layer refuses a re-route while applications are in review and never
// rewrites the chain a decided application was approved under.
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/guard";
import { audit, saveChain, listRouting } from "@wola/db";
import { EXCEPTION_APPLICANT_ROLES, type StageInput } from "@wola/engine";
import { ROUTING_EDIT_ROLES } from "@/lib/permissions";

export type SaveChainActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export async function saveChainAction(
  productId: string,
  appliesTo: string,
  stages: StageInput[],
): Promise<SaveChainActionResult> {
  if (appliesTo !== "default" && !EXCEPTION_APPLICANT_ROLES.includes(appliesTo)) {
    return { ok: false, error: "Unknown applicant group." };
  }
  return requireSession(async (tx, ctx) => {
    if (!ROUTING_EDIT_ROLES.includes(ctx.role)) {
      return { ok: false, error: "Only an administrator can change approval routing." };
    }
    const beforeChains = (await listRouting(tx)).find((p) => p.productId === productId)?.chains.find((c) => c.appliesTo === appliesTo);
    const res = await saveChain(tx, { tenantId: ctx.tenantId, productId, appliesTo, stages });
    if (!res.ok) return res;
    if (res.changed !== "none") {
      await audit(tx, {
        tenantId: ctx.tenantId, actorId: ctx.userId, action: "routing.save",
        entity: "loan_product", entityId: productId,
        before: { appliesTo, stages: beforeChains?.stages.map((s) => ({ role: s.role, slaHours: s.slaHours, allowDelegation: s.allowDelegation })) ?? [] },
        after: { appliesTo, change: res.changed, stages },
      });
    }
    revalidatePath("/settings/routing");
    revalidatePath("/settings/products");
    revalidatePath("/settings");
    const message =
      res.changed === "none" ? "No changes to save."
      : res.changed === "removed" ? "Exception removed. Those applicants now follow the standard chain."
      : res.changed === "tweaked" ? "Saved."
      : "Saved. New applications will follow this chain.";
    return { ok: true, message };
  });
}
