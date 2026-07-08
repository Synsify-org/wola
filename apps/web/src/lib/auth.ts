// apps/web/src/lib/auth.ts — hand-rolled, tenant-pinned sessions.
// Security model: cookie holds a random 256-bit token; DB holds only
// its SHA-256. Session is bound to (user_id, tenant_id). A session is
// only valid on the subdomain of the tenant it was issued for.
import "server-only";
import { randomBytes, createHash } from "node:crypto";
import * as argon2 from "argon2";
import { db } from "./tenant";
import { tenantTx, type Tx } from "@wola/db";

const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8h
const COOKIE = "wola_session";

export const hashPassword = (pw: string) =>
  argon2.hash(pw, { type: argon2.argon2id });

export async function verifyPassword(hash: string, pw: string) {
  try { return await argon2.verify(hash, pw); } catch { return false; }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Authenticate email+password FOR A SPECIFIC TENANT. Returns a raw
 *  token to set as a cookie, or null. Same null for every failure
 *  (no user, wrong password, no membership) so callers can't probe.
 *
 *  The membership lookup runs inside tenantTx() because `memberships`
 *  is RLS-protected: without a tenant context, Postgres hides the row
 *  and the JOIN returns nothing. We resolved the tenant from the
 *  subdomain before calling this, so scoping the read is correct. */
export async function login(email: string, password: string, tenantId: string) {
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

  if (!user || !user.password_hash || !ok) {
    return null;
  }

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  await db`INSERT INTO sessions (user_id, tenant_id, token_hash, expires_at)
    VALUES (${user.id}, ${tenantId}, ${sha256(token)}, ${expires})`;
  return { token, expires };
}

/** Verify a session cookie AGAINST the tenant of the current request.
 *  Returns the user id only if the session belongs to THIS tenant and
 *  hasn't expired. Tenant mismatch => null (the core isolation check). */
export async function verifySession(token: string | undefined, tenantId: string) {
  if (!token) return null;
  const [s] = await db`
    SELECT user_id, tenant_id, expires_at FROM sessions
    WHERE token_hash = ${sha256(token)}`;
  if (!s) return null;
  if (new Date(s.expires_at) < new Date()) return null;
  if (s.tenant_id !== tenantId) return null; // the cross-tenant replay block
  return { userId: s.user_id as string };
}

export async function logout(token: string | undefined) {
  if (token) await db`DELETE FROM sessions WHERE token_hash = ${sha256(token)}`;
}

export const SESSION_COOKIE = COOKIE;