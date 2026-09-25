// packages/db/src/auth.ts — password reset + login rate limiting.
//
// Kept separate from apps/web/src/lib/auth.ts, which owns the session
// COOKIE (a Next.js/"server-only" concern). Everything here is plain
// Node + Postgres, so it's directly testable with node:test — closing the
// gap DECISIONS.md flags: "Auth unit tests assert on raw SQL, not the real
// auth.ts functions." apps/web's login()/verifySession()/logout() still
// own the cookie; they call into this module for the pieces that don't
// need a cookie at all.
import { randomBytes, createHash } from "node:crypto";
import * as argon2 from "argon2";
import type { Sql, Tx } from "./client";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });

export async function verifyPassword(hash: string, pw: string) {
  try { return await argon2.verify(hash, pw); } catch { return false; }
}

// ---- Login rate limiting ------------------------------------------------
// Two limits over a rolling 15 minutes, both counting FAILED attempts only
// (migration 0018):
//
//   - 5 failures per (email, IP) pair: stops brute-forcing one account.
//     Keyed on the PAIR, not the email alone, so an attacker can't lock a
//     real user out by failing from many IPs (a denial-of-service on the
//     victim).
//   - 30 failures per IP across every email: stops password spraying (one
//     machine trying a common password against many accounts), which the
//     pair limit alone never sees. Successes don't count, so an office
//     signing in together from one NAT'd IP can't lock itself out.
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_MAX_IP_FAILURES = 30;

/** Record one login attempt — call for EVERY attempt, success or failure,
 *  before returning to the caller. An attempt that's never recorded is a
 *  gap in the limit. `succeeded` defaults to false: an unrecorded outcome
 *  counts against the limit, never for it. */
export async function recordLoginAttempt(
  sql: Sql, email: string, ip: string, succeeded = false,
): Promise<void> {
  await sql`INSERT INTO login_attempts (email, ip, succeeded) VALUES (${email}, ${ip}, ${succeeded})`;
}

/** True if either limit is hit: this (email, ip) pair has 5+ recent
 *  failures, or this IP has 30+ recent failures across all emails.
 *  Call BEFORE attempting the password check — a rate-limited request
 *  shouldn't even run argon2.verify (that's the expensive part). */
export async function isRateLimited(sql: Sql, email: string, ip: string): Promise<boolean> {
  const [row] = await sql`
    SELECT
      count(*) FILTER (WHERE email = ${email})::int AS pair,
      count(*)::int AS ip_total
    FROM login_attempts
    WHERE ip = ${ip} AND NOT succeeded AND created_at > now() - interval '15 minutes'`;
  return Number(row?.pair ?? 0) >= RATE_LIMIT_MAX_ATTEMPTS
    || Number(row?.ip_total ?? 0) >= RATE_LIMIT_MAX_IP_FAILURES;
}

// ---- Password reset -------------------------------------------------------
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface PasswordResetIssued {
  token: string;    // RAW token — only ever returned here, never stored
  expires: Date;
}

/** Issue a reset token, IF a user with this email has a membership in the
 *  given tenant. Returns null otherwise. Callers MUST NOT let that
 *  distinction reach the response — same enumeration defense as login():
 *  show an identical "if that email exists, we sent a link" message either
 *  way. This function tells the truth internally so the EMAIL only gets
 *  sent when there's really someone to send it to; the boundary that hides
 *  the truth is the caller (the server action), not this function.
 *
 *  Takes a Tx, not a Sql — it reads `memberships`, which is RLS-protected,
 *  so it must run inside a tenantTx (or it'll silently see zero rows). */
export async function createPasswordReset(
  tx: Tx,
  email: string,
  tenantId: string,
): Promise<PasswordResetIssued | null> {
  const [user] = await tx`
    SELECT u.id FROM users u
    JOIN memberships m ON m.user_id = u.id AND m.tenant_id = ${tenantId}
    WHERE u.email = ${email} AND u.status = 'active'`;
  if (!user) return null;

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + RESET_TTL_MS);
  await tx`
    INSERT INTO password_resets (user_id, token_hash, expires_at)
    VALUES (${user.id}, ${sha256(token)}, ${expires})`;
  return { token, expires };
}

export type ResetPasswordResult = { ok: true } | { ok: false; error: string };

/** Consume a reset token: set the new password, mark the token used (so it
 *  can never be replayed), and kill every existing session for that user —
 *  a password reset is exactly the moment you should NOT trust old
 *  sessions to still be the legitimate owner. */
export async function resetPassword(
  sql: Sql,
  token: string,
  newPassword: string,
): Promise<ResetPasswordResult> {
  const tokenHash = sha256(token);
  const [reset] = await sql`
    SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ${tokenHash}`;
  if (!reset) return { ok: false, error: "Invalid or expired reset link." };
  if (reset.used_at) return { ok: false, error: "This reset link has already been used." };
  if (new Date(reset.expires_at as string) < new Date()) {
    return { ok: false, error: "This reset link has expired." };
  }

  const hash = await hashPassword(newPassword);
  await sql.begin(async (tx) => {
    await tx`UPDATE users SET password_hash = ${hash} WHERE id = ${reset.user_id}`;
    await tx`UPDATE password_resets SET used_at = now() WHERE id = ${reset.id}`;
    await tx`DELETE FROM sessions WHERE user_id = ${reset.user_id}`;
  });
  return { ok: true };
}
