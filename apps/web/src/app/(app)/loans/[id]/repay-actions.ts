"use server";
// Record a repayment against an active loan. Finance roles only (same treasury
// boundary as disbursement). recordRepayment re-validates the loan is active and
// caps the allocation, so a stale button or double-submit can't corrupt the
// ledger. On full repayment the loan auto-settles.
import { requireSession } from "@/lib/guard";
import { recordRepayment, audit } from "@wola/db";
import { revalidatePath } from "next/cache";

const FINANCE_ROLES = ["cfo", "ceo", "md", "coo", "group_ceo", "admin", "org_admin"];

export type RepaymentResult =
  | { ok: true; outstanding: number; settled: boolean; reamortized: boolean }
  | { ok: false; error: string };

export async function recordRepaymentAction(
  loanId: string,
  amount: number,
  source: "payroll" | "manual",
): Promise<RepaymentResult> {
  if (!loanId) return { ok: false, error: "Missing loan." };
  if (!(amount > 0)) return { ok: false, error: "Amount must be positive." };

  return requireSession(async (tx, ctx) => {
    if (!FINANCE_ROLES.includes(ctx.role)) {
      return { ok: false, error: "You are not authorised to record repayments." };
    }
    try {
      const res = await recordRepayment(tx, {
        tenantId: ctx.tenantId,
        loanId,
        amount,
        source,
        postedBy: ctx.userId,
      });
      await audit(tx, {
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: "loan.repayment_recorded",
        entity: "loan",
        entityId: loanId,
        after: { amount, source, outstanding: res.outstanding, settled: res.settled, reamortized: res.reamortized },
      });
      revalidatePath(`/loans/${loanId}`);
      revalidatePath("/loans");
      revalidatePath("/book");
      revalidatePath("/");
      return { ok: true, outstanding: res.outstanding, settled: res.settled, reamortized: res.reamortized };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Failed to record repayment." };
    }
  });
}
