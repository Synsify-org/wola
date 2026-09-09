// apps/web/src/lib/super-admin-auth.ts — session cookie for the super-admin
// surface. Mirrors lib/auth.ts's tenant session exactly (random 256-bit
// token in the cookie, only its SHA-256 stored, "server-only" + Next request
// context here / plain Node+Postgres logic in packages/db), just against
// super_admin_sessions instead of the tenant-pinned sessions table.
import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { db } from "./tenant";
import { authenticateSuperAdmin } from "@wola/db";

const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8h — same as a tenant session
const COOKIE = "wola_super_session";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type SuperLoginResult =
  | { ok: true; token: string; expires: Date }
  | { ok: false; reason: "invalid" | "rate_limited" };

export async function superLogin(email: string, password: string, ip: string): Promise<SuperLoginResult> {
  const auth = await authenticateSuperAdmin(db, email, password, ip);
  if (!auth.ok) return auth;

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  await db`INSERT INTO super_admin_sessions (user_id, token_hash, expires_at)
    VALUES (${auth.userId}, ${sha256(token)}, ${expires})`;
  return { ok: true, token, expires };
}

/** Verify a super-admin session cookie. No tenant to match against — this
 *  surface is deliberately outside the tenant model entirely. */
export async function verifySuperSession(token: string | undefined) {
  if (!token) return null;
  const [s] = await db`
    SELECT user_id, expires_at FROM super_admin_sessions WHERE token_hash = ${sha256(token)}`;
  if (!s) return null;
  if (new Date(s.expires_at) < new Date()) return null;
  return { userId: s.user_id as string };
}

export async function superLogout(token: string | undefined) {
  if (token) await db`DELETE FROM super_admin_sessions WHERE token_hash = ${sha256(token)}`;
}

export const SUPER_SESSION_COOKIE = COOKIE;
