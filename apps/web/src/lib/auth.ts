// apps/web/src/lib/auth.ts — hand-rolled, tenant-pinned sessions.
// Security model: cookie holds a random 256-bit token; DB holds only
// its SHA-256. Session is bound to (user_id, tenant_id). A session is
// only valid on the subdomain of the tenant it was issued for.
//
// Password hashing, rate limiting, and password reset live in
// packages/db/src/auth.ts — plain Node/Postgres logic with no Next.js
// coupling, so it's directly unit-testable (see that file's header for
// why). This file owns only the session COOKIE, which does need
// "server-only" and Next's request context.
import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { db } from "./tenant";
import {
  tenantTx, type Tx,
  hashPassword, verifyPassword, isRateLimited, recordLoginAttempt,
} from "@wola/db";

const SESSION_TTL_MS = 1000 * 60 * 60 * 8;        // 8h — default
const SESSION_TTL_REMEMBER_MS = 1000 * 60 * 60 * 24 * 30; // 30d — "keep me signed in"
const COOKIE = "wola_session";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type LoginResult =
  | { ok: true; token: string; expires: Date }
  | { ok: false; reason: "invalid" | "rate_limited" };

/** Issue a tenant-pinned session for an already-authenticated user — the
 *  part of login() after credential verification. Shared with accept-invite,
 *  which authenticates by a one-time token instead of a password but needs
 *  the exact same session it would get from logging in right after. */
export async function createSession(
  userId: string, tenantId: string, remember = false,
): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + (remember ? SESSION_TTL_REMEMBER_MS : SESSION_TTL_MS));
  await db`INSERT INTO sessions (user_id, tenant_id, token_hash, expires_at)
    VALUES (${userId}, ${tenantId}, ${sha256(token)}, ${expires})`;
  return { token, expires };
}

/** Authenticate email+password FOR A SPECIFIC TENANT. Same "invalid" reason
 *  for every credential failure (no user, wrong password, no membership) so
 *  callers can't probe which one it was — rate_limited is fine to
 *  distinguish, since it doesn't reveal anything about whether the account
 *  exists, only that this (email, ip) pair has tried too many times.
 *
 *  The membership lookup runs inside tenantTx() because `memberships`
 *  is RLS-protected: without a tenant context, Postgres hides the row
 *  and the JOIN returns nothing. We resolved the tenant from the
 *  subdomain before calling this, so scoping the read is correct. */
// Input caps, checked before any hashing. argon2 cost scales with input, so an
// unbounded password is a cheap way to burn server CPU (a denial-of-service).
// 254 is the RFC 5321 maximum address length; 256 characters is far beyond
// any real passphrase.
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 256;

export async function login(
  rawEmail: string, password: string, tenantId: string, ip: string, remember = false,
): Promise<LoginResult> {
  // Normalise so " Grace@Co.com " and "grace@co.com" share one rate-limit
  // key and one lookup (users.email and login_attempts.email are citext, so
  // case already matches; surrounding whitespace did not).
  const email = rawEmail.trim().toLowerCase();

  if (await isRateLimited(db, email, ip)) {
    return { ok: false, reason: "rate_limited" };
  }

  // Oversized or empty input: refuse without running argon2 at all. Still
  // recorded as a failure, and the same "invalid" answer as a wrong
  // password, so it reveals nothing about the account.
  if (!email || email.length > MAX_EMAIL_LENGTH || !password || password.length > MAX_PASSWORD_LENGTH) {
    await recordLoginAttempt(db, email.slice(0, MAX_EMAIL_LENGTH) || "(empty)", ip, false);
    return { ok: false, reason: "invalid" };
  }

  const [user] = await tenantTx(db, tenantId, (tx: Tx) => tx`
    SELECT u.id, u.password_hash
    FROM users u
    JOIN memberships m ON m.user_id = u.id AND m.tenant_id = ${tenantId}
    WHERE u.email = ${email} AND u.status = 'active'`);

  // Always run a hash verify even when the user is missing, to keep
  // timing uniform (defeats user-enumeration by response time).
  // This dummy hash is load-bearing — do NOT remove it.
  const hash = user?.password_hash ?? "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const ok = await verifyPassword(hash, password);

  const succeeded = Boolean(user && user.password_hash && ok);

  // Recorded for EVERY attempt, with its outcome, before returning — the
  // rate limits count failures only (see packages/db/src/auth.ts).
  await recordLoginAttempt(db, email, ip, succeeded);

  if (!succeeded || !user) {
    return { ok: false, reason: "invalid" };
  }

  const { token, expires } = await createSession(user.id as string, tenantId, remember);
  return { ok: true, token, expires };
}

/** Verify a session cookie AGAINST the tenant of the current request.
 *  Returns the user id only if the session belongs to THIS tenant and
 *  hasn't expired. Tenant mismatch => null (the core isolation check). */
export async function verifySession(token: string | undefined, tenantId: string) {
  if (!token) return null;
  // The user must still be active: a deactivated account's existing
  // sessions stop working immediately, not when they happen to expire.
  const [s] = await db`
    SELECT s.user_id, s.tenant_id, s.expires_at FROM sessions s
    JOIN users u ON u.id = s.user_id AND u.status = 'active'
    WHERE s.token_hash = ${sha256(token)}`;
  if (!s) return null;
  if (new Date(s.expires_at) < new Date()) return null;
  if (s.tenant_id !== tenantId) return null; // the cross-tenant replay block
  return { userId: s.user_id as string };
}

export async function logout(token: string | undefined) {
  if (token) await db`DELETE FROM sessions WHERE token_hash = ${sha256(token)}`;
}

export const SESSION_COOKIE = COOKIE;