// apps/web/src/app/applications/[id]/actions.ts
// Approve / reject actions. All authorization lives in the engine (canAct);
// loan creation lives in createLoanFromApplication (see approvals.ts's
// decide()) — this file only wires the form to it, exactly once.
"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/guard";
import { decide } from "@wola/db";

export async function decideAction(formData: FormData) {
  const applicationId = String(formData.get("applicationId"));
  const decision = String(formData.get("decision")) as "approved" | "rejected";
  const comment = String(formData.get("comment") ?? "").trim() || null;
  // Only meaningful for the final approval stage — decide() enforces that
  // requirement itself and errors cleanly if it's missing there. Harmless to
  // pass on every decision otherwise (rejections and non-final approvals
  // ignore it).
  const startDateRaw = String(formData.get("startDate") ?? "").trim();
  const startDate = startDateRaw ? new Date(startDateRaw) : undefined;

  const result = await requireSession(async (tx, ctx) => {
    const [me] = await tx`SELECT id FROM employees WHERE user_id = ${ctx.userId}`;
    const actor = {
      userId: ctx.userId,
      employeeId: (me?.id as string) ?? null,
      role: ctx.role,
    };

    return decide(tx, {
      tenantId: ctx.tenantId, applicationId, actor, decision, comment, startDate,
    });
  });

  if (!result.ok) {
    redirect(`/applications/${applicationId}?error=${encodeURIComponent(result.error)}`);
  }
  revalidatePath(`/applications/${applicationId}`);
  redirect(`/approvals`);
}