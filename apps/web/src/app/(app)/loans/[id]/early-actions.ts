"use server";
// Early repayment, from the borrower's side: ask to pay a lump sum or the whole
// balance. Finance sees the request on the Payroll screen and records the money when it
// arrives (that is what changes the ledger). HR may ask on someone's behalf, e.g. when
// they are leaving and the balance is to be recovered.
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/guard";
import { EMPLOYEE_DATA_ROLES } from "@/lib/permissions";
import { audit, requestEarlyRepayment, cancelEarlyRepayment } from "@wola/db";

type Fail = { ok: false; error: string };

export async function requestEarlyAction(
  loanId: string, kind: "full" | "partial", amount: number | null, reason: string,
): Promise<{ ok: true; payoff: number } | Fail> {
  return requireSession(async (tx, ctx) => {
    const r = await requestEarlyRepayment(tx, {
      tenantId: ctx.tenantId, loanId, requestedBy: ctx.userId, kind, amount, reason,
      onBehalf: EMPLOYEE_DATA_ROLES.includes(ctx.role),
    });
    if (!r.ok) return r;
    await audit(tx, {
      tenantId: ctx.tenantId, actorId: ctx.userId, action: "repayment.early_requested", entity: "early_repayment_request", entityId: r.id,
      after: { loanId, kind, amount, payoff: r.payoff },
    });
    revalidatePath(`/loans/${loanId}`);
    revalidatePath("/reconciliation");
    return { ok: true, payoff: r.payoff };
  });
}

export async function cancelEarlyRequestAction(loanId: string, requestId: string): Promise<{ ok: true } | Fail> {
  return requireSession(async (tx, ctx) => {
    const r = await cancelEarlyRepayment(tx, { tenantId: ctx.tenantId, requestId, userId: ctx.userId });
    if (!r.ok) return r;
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, action: "repayment.early_cancelled", entity: "early_repayment_request", entityId: requestId, after: { loanId } });
    revalidatePath(`/loans/${loanId}`);
    revalidatePath("/reconciliation");
    return { ok: true };
  });
}
