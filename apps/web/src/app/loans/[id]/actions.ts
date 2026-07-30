"use server";
// Server action: disburse a pending loan. Only a full-book finance role (the
// people who move money — cfo/ceo/admin) may do this. The guard runs inside
// requireSession so the tenant + RLS context is enforced; disburseLoan itself
// re-checks the loan is 'pending_disbursement', so a double-submit or a stale
// button can't disburse twice.
import { requireSession } from "@/lib/guard";
import { disburseLoan, audit } from "@wola/db";
import { revalidatePath } from "next/cache";

// Roles allowed to move money. Kept narrow on purpose: an HR or dept head may
// see a loan but must not disburse it. Mirrors the treasury boundary in the
// role spec (finance/exec only).
const DISBURSER_ROLES = ["cfo", "ceo", "md", "coo", "admin"];

export type DisburseResult =
  | { ok: true; amount: number }
  | { ok: false; error: string };

export async function disburseAction(
  loanId: string,
  reference: string,
): Promise<DisburseResult> {
  if (!loanId) return { ok: false, error: "Missing loan." };

  return requireSession(async (tx, ctx) => {
    if (!DISBURSER_ROLES.includes(ctx.role)) {
      return { ok: false, error: "You are not authorised to disburse loans." };
    }

    try {
      const res = await disburseLoan(tx, {
        tenantId: ctx.tenantId,
        loanId,
        method: "to_employee",
        reference: reference?.trim() || null,
        postedBy: ctx.userId,
      });

      // Audit trail: who disbursed what, when. audit() is the existing
      // tenant-scoped logger in @wola/db.
      await audit(tx, {
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: "loan.disbursed",
        entity: "loan",
        entityId: loanId,
        after: { amount: res.amount, reference: reference?.trim() || null },
      });

      revalidatePath(`/loans/${loanId}`);
      revalidatePath("/loans");
      revalidatePath("/");
      return { ok: true, amount: res.amount };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Disbursement failed." };
    }
  });
}
