"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { superLogout, SUPER_SESSION_COOKIE } from "@/lib/super-admin-auth";

export async function superLogoutAction() {
  const token = (await cookies()).get(SUPER_SESSION_COOKIE)?.value;
  await superLogout(token);
  (await cookies()).delete(SUPER_SESSION_COOKIE);
  redirect("/admin/login");
}

// ---- Two-step sign-in for the platform console ----------------------------
// Mandatory once the server can verify codes (see lib/super-admin-auth.ts): there is
// no "turn off". Everything here uses skipMfaGate, since it is how a session that
// has not yet proven its second factor gets there.
import { requireSuperSession } from "@/lib/super-admin-guard";
import { db } from "@/lib/tenant";
import {
  beginEnrollment, confirmEnrollment, consumeSecondFactor, mfaKey, otpauthUri, replaceRecoveryCodes,
} from "@wola/db";
import { markSuperSessionVerified } from "@/lib/super-admin-auth";

const OFF = "Two-step sign-in isn't set up on this server yet (MFA_ENCRYPTION_KEY).";
const gate = { skipMfaGate: true };
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function superStartMfaAction(): Promise<Result<{ secret: string; uri: string }>> {
  const key = mfaKey();
  if (!key) return { ok: false, error: OFF };
  return requireSuperSession(async (ctx) => {
    const r = await beginEnrollment(db, ctx.userId, key);
    if (!r.ok) return r;
    const [u] = await db`SELECT email FROM users WHERE id = ${ctx.userId}`;
    return { ok: true, secret: r.secret, uri: otpauthUri(`platform:${(u?.email as string) ?? "admin"}`, r.secret) };
  }, gate);
}

export async function superConfirmMfaAction(code: string): Promise<Result<{ recoveryCodes: string[] }>> {
  const key = mfaKey();
  if (!key) return { ok: false, error: OFF };
  return requireSuperSession(async (ctx) => {
    const r = await confirmEnrollment(db, ctx.userId, code, key);
    if (!r.ok) return r;
    // The code was just proven, so this session is now fully signed in.
    await markSuperSessionVerified((await cookies()).get(SUPER_SESSION_COOKIE)?.value);
    return { ok: true, recoveryCodes: r.recoveryCodes };
  }, gate);
}

export async function superNewRecoveryCodesAction(code: string): Promise<Result<{ recoveryCodes: string[] }>> {
  const key = mfaKey();
  if (!key) return { ok: false, error: OFF };
  return requireSuperSession(async (ctx) => {
    if (!(await consumeSecondFactor(db, ctx.userId, code, key)).ok) {
      return { ok: false, error: "That code isn't right. Enter the newest code from your app." };
    }
    return { ok: true, recoveryCodes: await replaceRecoveryCodes(db, ctx.userId) };
  }, gate);
}

/** There is no turning it off for the platform console. */
export async function superDisableMfaAction(): Promise<Result> {
  return { ok: false, error: "Two-step sign-in can't be turned off for the platform console." };
}
