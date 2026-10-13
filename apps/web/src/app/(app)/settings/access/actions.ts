"use server";
// Roles & access. Administrators only (ACCESS_EDIT_ROLES). The DB layer also
// enforces: no self-change, never zero administrators, one membership per
// person. Role changes and removals bite on the person's very next request —
// the guard reads the membership fresh each time.
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/guard";
import { audit, changeRole, removeAccess, inviteToOrganisation, revokeInvite } from "@wola/db";
import { ACCESS_EDIT_ROLES } from "@/lib/permissions";
import { requestOrigin, sendInviteEmail } from "@/lib/invite-email";

type Result = { ok: true; note?: string } | { ok: false; error: string };
const DENIED = "Only an administrator can change who has access.";

export async function changeRoleAction(targetUserId: string, newRole: string): Promise<Result> {
  return requireSession(async (tx, ctx) => {
    if (!ACCESS_EDIT_ROLES.includes(ctx.role)) return { ok: false, error: DENIED };
    const res = await changeRole(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, targetUserId, newRole });
    if (!res.ok) return res;
    await audit(tx, {
      tenantId: ctx.tenantId, actorId: ctx.userId, action: "access.role_changed",
      entity: "user", entityId: targetUserId, before: { role: res.before }, after: { role: newRole },
    });
    revalidatePath("/settings/access");
    return { ok: true };
  });
}

export async function removeAccessAction(targetUserId: string): Promise<Result> {
  return requireSession(async (tx, ctx) => {
    if (!ACCESS_EDIT_ROLES.includes(ctx.role)) return { ok: false, error: DENIED };
    const res = await removeAccess(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, targetUserId });
    if (!res.ok) return res;
    await audit(tx, {
      tenantId: ctx.tenantId, actorId: ctx.userId, action: "access.removed",
      entity: "user", entityId: targetUserId, before: { role: res.before },
    });
    revalidatePath("/settings/access");
    revalidatePath("/settings/employees");
    return { ok: true };
  });
}

export async function inviteAction(email: string, role: string, employeeId: string | null): Promise<Result> {
  const origin = await requestOrigin();
  return requireSession(async (tx, ctx) => {
    if (!ACCESS_EDIT_ROLES.includes(ctx.role)) return { ok: false, error: DENIED };
    const res = await inviteToOrganisation(tx, {
      tenantId: ctx.tenantId, invitedById: ctx.userId, email, role, employeeId,
    });
    if (!res.ok) return res;
    await sendInviteEmail(tx, {
      tenantId: ctx.tenantId, to: res.email, role, token: res.token, origin, inviterUserId: ctx.userId,
    });
    await audit(tx, {
      tenantId: ctx.tenantId, actorId: ctx.userId, action: "access.invited",
      entity: "invitation", after: { email: res.email, role, employeeId },
    });
    revalidatePath("/settings/access");
    revalidatePath("/settings/employees");
    return { ok: true, note: `Invitation sent to ${res.email}.` };
  });
}

export async function revokeInviteAction(inviteId: string): Promise<Result> {
  return requireSession(async (tx, ctx) => {
    if (!ACCESS_EDIT_ROLES.includes(ctx.role)) return { ok: false, error: DENIED };
    const res = await revokeInvite(tx, { tenantId: ctx.tenantId, inviteId });
    if (!res.ok) return res;
    await audit(tx, {
      tenantId: ctx.tenantId, actorId: ctx.userId, action: "access.invite_revoked",
      entity: "invitation", entityId: inviteId,
    });
    revalidatePath("/settings/access");
    return { ok: true };
  });
}
