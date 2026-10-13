"use server";
// Two-step sign-in: set up, turn off, new recovery codes, and the organisation's
// policy for which roles must use it. Every action here uses skipMfaGate — these
// are the pages a person who is REQUIRED to enrol has to be able to reach.
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/guard";
import { db } from "@/lib/tenant";
import {
  audit, beginEnrollment, confirmEnrollment, consumeSecondFactor, disableMfa,
  mfaKey, otpauthUri, replaceRecoveryCodes,
} from "@wola/db";
import { MEMBERSHIP_ROLES } from "@wola/engine";
import { ACCESS_EDIT_ROLES } from "@/lib/permissions";

const OFF = "Two-step sign-in isn't set up on this server yet. Ask your administrator.";
const gate = { skipMfaGate: true };

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function emailOf(userId: string): Promise<string> {
  const [u] = await db`SELECT email FROM users WHERE id = ${userId}`;
  return (u?.email as string) ?? "account";
}

export async function startMfaAction(): Promise<Result<{ secret: string; uri: string }>> {
  const key = mfaKey();
  if (!key) return { ok: false, error: OFF };
  return requireSession(async (_tx, ctx) => {
    const r = await beginEnrollment(db, ctx.userId, key);
    if (!r.ok) return r;
    return { ok: true, secret: r.secret, uri: otpauthUri(await emailOf(ctx.userId), r.secret) };
  }, gate);
}

export async function confirmMfaAction(code: string): Promise<Result<{ recoveryCodes: string[] }>> {
  const key = mfaKey();
  if (!key) return { ok: false, error: OFF };
  return requireSession(async (tx, ctx) => {
    const r = await confirmEnrollment(db, ctx.userId, code, key);
    if (!r.ok) return r;
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, action: "mfa.enabled", entity: "user", entityId: ctx.userId });
    revalidatePath("/settings/security");
    return { ok: true, recoveryCodes: r.recoveryCodes };
  }, gate);
}

export async function disableMfaAction(code: string): Promise<Result> {
  const key = mfaKey();
  if (!key) return { ok: false, error: OFF };
  return requireSession(async (tx, ctx) => {
    const [t] = await tx`SELECT settings FROM tenants WHERE id = ${ctx.tenantId}`;
    const required = ((t?.settings ?? {}) as { security?: { mfaRequiredRoles?: string[] } }).security?.mfaRequiredRoles ?? [];
    if (required.includes(ctx.role)) {
      return { ok: false, error: "Your organisation requires two-step sign-in for your role, so it can't be turned off." };
    }
    if (!(await consumeSecondFactor(db, ctx.userId, code, key)).ok) {
      return { ok: false, error: "That code isn't right. Enter the newest code from your app, or a recovery code." };
    }
    await disableMfa(db, ctx.userId);
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, action: "mfa.disabled", entity: "user", entityId: ctx.userId });
    revalidatePath("/settings/security");
    return { ok: true };
  }, gate);
}

export async function newRecoveryCodesAction(code: string): Promise<Result<{ recoveryCodes: string[] }>> {
  const key = mfaKey();
  if (!key) return { ok: false, error: OFF };
  return requireSession(async (tx, ctx) => {
    if (!(await consumeSecondFactor(db, ctx.userId, code, key)).ok) {
      return { ok: false, error: "That code isn't right. Enter the newest code from your app." };
    }
    const recoveryCodes = await replaceRecoveryCodes(db, ctx.userId);
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, action: "mfa.recovery_codes_renewed", entity: "user", entityId: ctx.userId });
    revalidatePath("/settings/security");
    return { ok: true, recoveryCodes };
  }, gate);
}

/** Which roles must use two-step sign-in. Administrators only. Refused when the
 *  server has no key (nobody could comply, so it would lock those roles out). */
export async function saveMfaPolicyAction(roles: string[]): Promise<Result> {
  if (!mfaKey()) return { ok: false, error: OFF };
  const clean = [...new Set(roles)].filter((r) => (MEMBERSHIP_ROLES as readonly string[]).includes(r));
  return requireSession(async (tx, ctx) => {
    if (!ACCESS_EDIT_ROLES.includes(ctx.role)) return { ok: false, error: "Only an administrator can change this." };
    await tx`
      UPDATE tenants
      SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{security}',
                               ${tx.json({ mfaRequiredRoles: clean })}::jsonb, true)
      WHERE id = ${ctx.tenantId}`;
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, action: "mfa.policy_changed", entity: "tenant", entityId: ctx.tenantId, after: { mfaRequiredRoles: clean } });
    revalidatePath("/settings/security");
    return { ok: true };
  }, gate);
}
