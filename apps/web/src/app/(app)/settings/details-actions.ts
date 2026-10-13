"use server";
// Settings actions that any signed-in person (or an administrator, for the policy) uses.
//  - updateMyDetailsAction: the person's OWN phone and location. Name, employee number,
//    department and pay stay with HR; they are not editable here.
//  - saveLoanExitPolicyAction: what happens to a loan when its borrower leaves.
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { audit } from "@wola/db";

type Result = { ok: true } | { ok: false; error: string; field?: "phone" | "location" };

const PHONE = /^[+]?[0-9 ()-]{6,32}$/;

export async function updateMyDetailsAction(input: { phone: string; location: string }): Promise<Result> {
  const phone = input.phone.trim();
  const location = input.location.trim();
  if (phone && !PHONE.test(phone)) return { ok: false, field: "phone", error: "Use digits, spaces, + ( ) or -, for example +256 772 123 456." };
  if (location.length > 120) return { ok: false, field: "location", error: "Keep the location under 120 characters." };

  return requireSession(async (tx, ctx) => {
    const res = await tx`
      UPDATE employees SET phone = ${phone || null}, location = ${location || null}, updated_at = now()
      WHERE tenant_id = ${ctx.tenantId} AND user_id = ${ctx.userId}
      RETURNING id`;
    if (res.length === 0) return { ok: false, error: "You don't have an employee record to update. Ask HR to link your account." };
    await audit(tx, {
      tenantId: ctx.tenantId, actorId: ctx.userId, action: "employees.own_details_updated", entity: "employee", entityId: res[0].id as string,
      after: { phone: Boolean(phone), location: Boolean(location) }, // not the values themselves
    });
    revalidatePath("/settings");
    return { ok: true };
  });
}

export async function saveLoanExitPolicyAction(policy: "recover_balance" | "manual"): Promise<Result> {
  if (policy !== "recover_balance" && policy !== "manual") return { ok: false, error: "Pick one of the two options." };
  return requireSession(async (tx, ctx) => {
    if (!can(ctx.role, "access.edit")) return { ok: false, error: "Only an administrator can change this." };
    await tx`
      UPDATE tenants
      SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{loanExit}', ${tx.json({ policy })}::jsonb, true)
      WHERE id = ${ctx.tenantId}`;
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, action: "settings.loan_exit_policy_changed", entity: "tenant", entityId: ctx.tenantId, after: { policy } });
    revalidatePath("/settings");
    return { ok: true };
  });
}
