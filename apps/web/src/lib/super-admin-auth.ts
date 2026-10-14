// apps/web/src/lib/super-admin-auth.ts — session cookie for the super-admin
// surface. Mirrors lib/auth.ts's tenant session exactly (random 256-bit
// token in the cookie, only its SHA-256 stored, "server-only" + Next request
// context here / plain Node+Postgres logic in packages/db), just against
// super_admin_sessions instead of the tenant-pinned sessions table.
import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { db } from "./tenant";
import { authenticateSuperAdmin, createChallenge, verifyChallenge, getMfaStatus, mfaKey, isRateLimited, recordLoginAttempt, recordPlatformEvent } from "@wola/db";

const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8h — same as a tenant session
const COOKIE = "wola_super_session";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ---- Sign-in ---------------------------------------------------------------
// The platform console sees every organisation, so once the server can verify codes
// (MFA_ENCRYPTION_KEY is set) a second factor is REQUIRED, not optional:
//   enrolled      password OK -> a challenge (no session) -> code OK -> session
//   not enrolled  password OK -> a session that can reach ONLY the setup page, until
//                 the person proves their authenticator works
//   no key set    password only, as before (nobody could enrol; this is logged in
//                 docs/SECURITY_AUDIT.md as the state to leave behind)
export type SuperLoginResult =
  | { ok: true; step: "done" | "enroll"; token: string; expires: Date }
  | { ok: true; step: "code"; challenge: string }
  | { ok: false; reason: "invalid" | "rate_limited" };

async function issueSession(userId: string, verified: boolean, ip: string, how: string) {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  await db`INSERT INTO super_admin_sessions (user_id, token_hash, expires_at, mfa_verified_at)
    VALUES (${userId}, ${sha256(token)}, ${expires}, ${verified ? new Date() : null})`;
  // The operators' own audit trail: who signed in, from where, and how (never the secrets).
  await recordPlatformEvent(db, { actorId: userId, action: "platform.signed_in", ip, detail: { how } });
  return { token, expires };
}

export async function superLogin(email: string, password: string, ip: string): Promise<SuperLoginResult> {
  const auth = await authenticateSuperAdmin(db, email, password, ip);
  if (!auth.ok) return auth;

  if (!mfaKey()) return { ok: true, step: "done", ...(await issueSession(auth.userId, true, ip, "password only")) };
  if ((await getMfaStatus(db, auth.userId)).enrolled) {
    return { ok: true, step: "code", challenge: await createChallenge(db, { userId: auth.userId, tenantId: null, remember: false }) };
  }
  return { ok: true, step: "enroll", ...(await issueSession(auth.userId, false, ip, "password, setting up two-step")) };
}

/** Second step: a code for a platform challenge. Wrong codes burn the challenge's
 *  attempts (5), then the password must be entered again. */
export async function superCompleteLogin(challenge: string, code: string, ip: string) {
  // A wrong code counts as a failed login for this (email, ip), as on the tenant side, so
  // asking for fresh challenges can't be used to keep guessing codes.
  const [row] = await db`
    SELECT u.email FROM mfa_challenges c JOIN users u ON u.id = c.user_id WHERE c.token_hash = ${sha256(challenge)}`;
  const email = (row?.email as string | undefined) ?? "";
  if (email && (await isRateLimited(db, email, ip))) return { ok: false as const, reason: "locked" as const };
  const r = await verifyChallenge(db, { token: challenge, tenantId: null, code, key: mfaKey() });
  if (!r.ok) {
    if (email && (r.reason === "invalid" || r.reason === "locked")) await recordLoginAttempt(db, email, ip, false);
    return r;
  }
  return { ok: true as const, ...(await issueSession(r.userId, true, ip, r.via === "recovery" ? "password and recovery code" : "password and authenticator code")) };
}

/** Verify a super-admin session cookie. No tenant to match against: this
 *  surface is deliberately outside the tenant model entirely. `mfaVerified` is
 *  true when the second factor was proven for this session, or when the server
 *  has no key to verify with (then nothing is enforceable). */
export async function verifySuperSession(token: string | undefined) {
  if (!token) return null;
  const [s] = await db`
    SELECT user_id, expires_at, mfa_verified_at FROM super_admin_sessions WHERE token_hash = ${sha256(token)}`;
  if (!s) return null;
  if (new Date(s.expires_at) < new Date()) return null;
  return { userId: s.user_id as string, mfaVerified: Boolean(s.mfa_verified_at) || !mfaKey() };
}

/** Mark the current session as having passed the second factor (end of enrolment). */
export async function markSuperSessionVerified(token: string | undefined) {
  if (token) await db`UPDATE super_admin_sessions SET mfa_verified_at = now() WHERE token_hash = ${sha256(token)}`;
}

export async function superLogout(token: string | undefined) {
  if (token) await db`DELETE FROM super_admin_sessions WHERE token_hash = ${sha256(token)}`;
}

export const SUPER_SESSION_COOKIE = COOKIE;
