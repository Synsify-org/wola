"use server";
// Set a tenant's rate index (e.g. BoU CBR). Interest-bearing products with no
// rate index hard-fail final approval in resolveRate() (approvals.ts) — this
// is the admin action that closes that gap, matching the architecture spec's
// "Configuration status" checklist item ("Rate index (CBR) set").
import { requireSession } from "@/lib/guard";
import { setRateIndex, audit } from "@wola/db";
import { revalidatePath } from "next/cache";
import { RATE_INDEX_EDIT_ROLES } from "@/lib/permissions";

export type SetRateIndexResult =
  | { ok: true; productsRepointed: number }
  | { ok: false; error: string };

export async function setRateIndexAction(
  name: string,
  value: number,
): Promise<SetRateIndexResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Enter a name for the rate." };
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, error: "Enter a rate of zero or more." };
  }

  return requireSession(async (tx, ctx) => {
    if (!RATE_INDEX_EDIT_ROLES.includes(ctx.role)) {
      return { ok: false, error: "Only the CFO or an administrator can change a rate index." };
    }
    try {
      const res = await setRateIndex(tx, { tenantId: ctx.tenantId, name: trimmed, value });
      await audit(tx, {
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: "rate_index.set",
        entity: "rate_index",
        entityId: res.id,
        after: { name: trimmed, value, productsRepointed: res.productsRepointed },
      });
      revalidatePath("/settings");
      return { ok: true, productsRepointed: res.productsRepointed };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Failed to set rate index." };
    }
  });
}
