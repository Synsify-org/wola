"use server";
// Roles & access. Administrators only (ACCESS_EDIT_ROLES). The DB layer also
// enforces: no self-change, never zero administrators, one membership per
// person. Role changes and removals bite on the person's very next request —
// the guard reads the membership fresh each time.
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/guard";
import { audit, changeRole, removeAccess, inviteToOrganisation, revokeInvite, parseBulkInvites, planBulkInvites, MAX_BULK_INVITES } from "@wola/db";
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

export type BulkInviteRowResult = { line: number; employeeNo: string; name: string | null; email: string; role: string; problem: string | null };
export type BulkInviteResult =
  | { ok: true; rows: BulkInviteRowResult[]; noEmail: number; willInvite: number; sent: number | null }
  | { ok: false; error: string };

/** Invite many people from a list. With send = false it only CHECKS the list (writes nothing) and
 *  reports, row by row, what would happen; with send = true it invites everyone who passed. Each
 *  person goes through the same inviteToOrganisation + email path as a single invitation. */
export async function bulkInviteAction(csvText: string, send: boolean): Promise<BulkInviteResult> {
  if (csvText.length > 400_000) return { ok: false, error: "That file is too large. Send at most " + MAX_BULK_INVITES + " people at a time." };
  const origin = await requestOrigin();
  return requireSession(async (tx, ctx) => {
    if (!ACCESS_EDIT_ROLES.includes(ctx.role)) return { ok: false, error: DENIED };
    const parsed = parseBulkInvites(csvText);
    if (parsed.errors.length) return { ok: false, error: parsed.errors.join(" ") };
    if (!parsed.rows.length) return { ok: false, error: "No rows to invite." };

    const planned = await planBulkInvites(tx, ctx.tenantId, parsed.rows);
    const shape = (p: (typeof planned)[number]): BulkInviteRowResult => ({ line: p.line, employeeNo: p.employeeNo, name: p.name, email: p.email, role: p.role, problem: p.problem });
    const ok = planned.filter((p) => !p.problem && !p.skipped);
    const noEmail = planned.filter((p) => p.skipped).length;
    if (!send) return { ok: true, rows: planned.map(shape), noEmail, willInvite: ok.length, sent: null };

    let sent = 0;
    for (const p of ok) {
      const res = await inviteToOrganisation(tx, { tenantId: ctx.tenantId, invitedById: ctx.userId, email: p.email, role: p.role, employeeId: p.employeeId });
      if (!res.ok) { p.problem = res.error; continue; }
      await sendInviteEmail(tx, { tenantId: ctx.tenantId, to: res.email, role: p.role, token: res.token, origin, inviterUserId: ctx.userId });
      sent++;
    }
    await audit(tx, {
      tenantId: ctx.tenantId, actorId: ctx.userId, action: "access.bulk_invited",
      entity: "invitation", after: { invited: sent, notInvited: planned.length - sent, noEmail },
    });
    revalidatePath("/settings/access");
    revalidatePath("/settings/employees");
    return { ok: true, rows: planned.map(shape), noEmail, willInvite: ok.length, sent };
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
