"use server";
// Set a tenant's rate index (e.g. BoU CBR). Interest-bearing products with no
// rate index hard-fail final approval in resolveRate() (approvals.ts) — this
// is the admin action that closes that gap, matching the architecture spec's
// "Configuration status" checklist item ("Rate index (CBR) set").
import { requireSession } from "@/lib/guard";
import { setRateIndex, audit } from "@wola/db";
import { revalidatePath } from "next/cache";

const ADMIN_ROLES = ["cfo", "ceo", "md", "coo", "group_ceo", "admin", "org_admin"];

export type SetRateIndexResult =
  | { ok: true; productsRepointed: number }
  | { ok: false; error: string };

export async function setRateIndexAction(
  name: string,
  value: number,
): Promise<SetRateIndexResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name is required." };
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, error: "Rate must be a non-negative number." };
  }

  return requireSession(async (tx, ctx) => {
    if (!ADMIN_ROLES.includes(ctx.role)) {
      return { ok: false, error: "You are not authorised to configure rate indices." };
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
