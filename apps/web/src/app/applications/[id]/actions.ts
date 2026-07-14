// apps/web/src/app/applications/[id]/actions.ts
// Approve / reject / generate-schedule actions. All authorization lives in the
// engine (canAct) — this file only wires the form to it.
"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/guard";
import { decide, routeApplication, persistSchedule } from "@wola/db";
import { stageCanGenerateSchedule } from "@wola/engine";

export async function decideAction(formData: FormData) {
  const applicationId = String(formData.get("applicationId"));
  const decision = String(formData.get("decision")) as "approved" | "rejected";
  const comment = String(formData.get("comment") ?? "").trim() || null;

  const result = await requireSession(async (tx, ctx) => {
    const [me] = await tx`SELECT id FROM employees WHERE user_id = ${ctx.userId}`;
    const actor = {
      userId: ctx.userId,
      employeeId: (me?.id as string) ?? null,
      role: ctx.role,
    };

    const outcome = await decide(tx, {
      tenantId: ctx.tenantId, applicationId, actor, decision, comment,
    });
    if (!outcome.ok) return outcome;

    // Fully approved => create the loan from the (already generated) schedule.
    if (outcome.routing.state === "approved") {
      const loaded = await routeApplication(tx, applicationId);
      if (!loaded) return { ok: false as const, error: "Application vanished." };

      const [snap] = await tx`
        SELECT eligibility_snapshot FROM loan_applications WHERE id = ${applicationId}`;
      const interestApplies = Boolean(snap?.eligibility_snapshot?.interestApplies);
      const annualRate = interestApplies ? 0.16 : 0;   // TODO: wire rate_indices

      const [loan] = await tx`
        INSERT INTO loans
          (tenant_id, application_id, principal, annual_rate, rate_mode,
           start_date, tenor_months, status)
        VALUES
          (${ctx.tenantId}, ${applicationId}, ${loaded.app.amount}, ${annualRate},
           'fixed', ${new Date()}, ${loaded.app.tenorMonths}, 'active')
        RETURNING id`;

      await persistSchedule(tx, {
        tenantId: ctx.tenantId, loanId: loan.id as string,
        principal: loaded.app.amount, annualRate,
        tenorMonths: loaded.app.tenorMonths,
        startDate: new Date(), decimals: 0,
      });
    }
    return outcome;
  });

  if (!result.ok) {
    redirect(`/applications/${applicationId}?error=${encodeURIComponent(result.error)}`);
  }
  revalidatePath(`/applications/${applicationId}`);
  redirect(`/approvals`);
}