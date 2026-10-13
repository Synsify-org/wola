// packages/db/src/mfa.ts
// Two-step sign-in with an authenticator app (TOTP, RFC 6238) and one-time
// recovery codes. Plain Node + Postgres, no Next.js coupling — directly
// unit-testable (see test/mfa.test.mjs, which checks the RFC's own vectors).
//
// Threat model, in short:
//   * a stolen password alone is not enough to sign in;
//   * the authenticator secret is stored ENCRYPTED (AES-256-GCM) with a key that
//     lives in the environment (MFA_ENCRYPTION_KEY), so a database leak alone
//     doesn't hand out second factors;
//   * a code can be used once (last_used_step), codes are accepted only in a
//     +/-1 step window, and a challenge allows MAX_ATTEMPTS wrong tries;
//   * recovery codes are single-use and stored hashed;
//   * if the key is missing, enrolment is unavailable and an already-enrolled
//     user CANNOT sign in (fail closed) — never silently skip the second step.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Sql } from "./client";

export const MFA_ISSUER = "Wola";
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const RECOVERY_CODE_COUNT = 10;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ------------------------------------------------------------------ base32

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Invalid base32 secret.");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// -------------------------------------------------------------------- TOTP

/** A fresh 160-bit secret, base32 (what authenticator apps expect). */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** HOTP (RFC 4226) for a counter, truncated to `digits`. */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 10 ** digits).padStart(digits, "0");
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / TOTP_STEP_SECONDS);

/** The code an authenticator app would show for this secret at `ms`. */
export function totpAt(secretB32: string, ms: number, digits = TOTP_DIGITS): string {
  return hotp(base32Decode(secretB32), stepAt(ms), digits);
}

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Check a 6-digit code within +/-1 step of now. Returns the step it matched
 *  (so the caller can store it) or null. A step <= lastUsedStep is a replay. */
export function verifyTotp(
  secretB32: string, code: string, opts: { now?: number; lastUsedStep?: number | null } = {},
): { step: number } | null {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const secret = base32Decode(secretB32);
  const now = stepAt(opts.now ?? Date.now());
  const last = opts.lastUsedStep ?? -1;
  for (const step of [now, now - 1, now + 1]) {
    if (step <= last) continue;
    if (safeEq(hotp(secret, step), clean)) return { step };
  }
  return null;
}

/** otpauth:// URI: opens an authenticator app on a phone. */
export function otpauthUri(accountLabel: string, secretB32: string): string {
  const label = encodeURIComponent(`${MFA_ISSUER}:${accountLabel}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(MFA_ISSUER)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

// -------------------------------------------------------- secret encryption

/** The 32-byte key from MFA_ENCRYPTION_KEY (base64), or null if unset/invalid.
 *  Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" */
export function mfaKey(env: string | undefined = process.env.MFA_ENCRYPTION_KEY): Buffer | null {
  if (!env) return null;
  const k = Buffer.from(env, "base64");
  return k.length === 32 ? k : null;
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(enc: string, key: Buffer): string {
  const [iv, tag, ct] = enc.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

// ---------------------------------------------------------- recovery codes

/** Crockford-style alphabet without 0/O/1/I/L: easy to read out and retype. */
const RC_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newRecoveryCode(): string {
  const bytes = randomBytes(10);
  let s = "";
  for (const b of bytes) s += RC_ALPHABET[b % RC_ALPHABET.length];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

/** Normalise what a person typed: case, spaces, missing dash. */
export function normaliseRecoveryCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length === 10 ? `${s.slice(0, 5)}-${s.slice(5)}` : null;
}

// ----------------------------------------------------------------- database

export interface MfaStatus {
  /** Enrolment finished: sign-in asks for a code. */
  enrolled: boolean;
  /** A secret was generated but never confirmed. */
  pending: boolean;
  recoveryCodesLeft: number;
}

export async function getMfaStatus(sql: Sql, userId: string): Promise<MfaStatus> {
  const [m] = await sql`SELECT enabled_at FROM user_mfa WHERE user_id = ${userId}`;
  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id = ${userId} AND used_at IS NULL`;
  return { enrolled: Boolean(m?.enabled_at), pending: Boolean(m && !m.enabled_at), recoveryCodesLeft: Number(n) };
}

/** Start (or restart) enrolment: a new secret, not yet active. Refuses if
 *  two-step sign-in is already on — disable it first. */
export async function beginEnrollment(
  sql: Sql, userId: string, key: Buffer,
): Promise<{ ok: true; secret: string } | { ok: false; error: string }> {
  const [m] = await sql`SELECT enabled_at FROM user_mfa WHERE user_id = ${userId}`;
  if (m?.enabled_at) return { ok: false, error: "Two-step sign-in is already on." };
  const secret = generateSecret();
  await sql`
    INSERT INTO user_mfa (user_id, secret_enc) VALUES (${userId}, ${encryptSecret(secret, key)})
    ON CONFLICT (user_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, last_used_step = NULL, created_at = now()`;
  return { ok: true, secret };
}

/** Finish enrolment by proving the app produces a valid code. Returns the
 *  recovery codes ONCE (only their hashes are kept). */
export async function confirmEnrollment(
  sql: Sql, userId: string, code: string, key: Buffer, now = Date.now(),
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; error: string }> {
  const [m] = await sql`SELECT secret_enc, enabled_at FROM user_mfa WHERE user_id = ${userId}`;
  if (!m || m.enabled_at) return { ok: false, error: "Start setup again." };
  const hit = verifyTotp(decryptSecret(m.secret_enc as string, key), code, { now });
  if (!hit) return { ok: false, error: "That code isn't right. Check the time on your phone and try the newest code." };
  await sql`UPDATE user_mfa SET enabled_at = now(), last_used_step = ${hit.step} WHERE user_id = ${userId}`;
  return { ok: true, recoveryCodes: await replaceRecoveryCodes(sql, userId) };
}

/** Replace all recovery codes with a fresh set (returned once). */
export async function replaceRecoveryCodes(sql: Sql, userId: string): Promise<string[]> {
  await sql`DELETE FROM mfa_recovery_codes WHERE user_id = ${userId}`;
  const codes: string[] = [];
  while (codes.length < RECOVERY_CODE_COUNT) {
    const c = newRecoveryCode();
    if (!codes.includes(c)) codes.push(c);
  }
  for (const c of codes) {
    await sql`INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (${userId}, ${sha256(c)})`;
  }
  return codes;
}

/** Check a code against a user's active secret OR an unused recovery code, and
 *  consume it. Shared by sign-in, "turn off" and "new recovery codes". */
export async function consumeSecondFactor(
  sql: Sql, userId: string, input: string, key: Buffer, now = Date.now(),
): Promise<{ ok: true; via: "app" | "recovery" } | { ok: false }> {
  const [m] = await sql`SELECT secret_enc, last_used_step FROM user_mfa WHERE user_id = ${userId} AND enabled_at IS NOT NULL`;
  if (!m) return { ok: false };

  const hit = verifyTotp(decryptSecret(m.secret_enc as string, key), input, {
    now, lastUsedStep: m.last_used_step === null ? null : Number(m.last_used_step),
  });
  if (hit) {
    // Compare-and-set so two simultaneous requests can't both spend one code.
    const res = await sql`
      UPDATE user_mfa SET last_used_step = ${hit.step}
      WHERE user_id = ${userId} AND (last_used_step IS NULL OR last_used_step < ${hit.step}) RETURNING user_id`;
    return res.length ? { ok: true, via: "app" } : { ok: false };
  }

  const rc = normaliseRecoveryCode(input);
  if (rc) {
    const res = await sql`
      UPDATE mfa_recovery_codes SET used_at = now()
      WHERE user_id = ${userId} AND code_hash = ${sha256(rc)} AND used_at IS NULL RETURNING id`;
    if (res.length) return { ok: true, via: "recovery" };
  }
  return { ok: false };
}

/** Turn two-step sign-in off (the caller has already checked a code). */
export async function disableMfa(sql: Sql, userId: string): Promise<void> {
  await sql`DELETE FROM mfa_recovery_codes WHERE user_id = ${userId}`;
  await sql`DELETE FROM user_mfa WHERE user_id = ${userId}`;
}

// -------------------------------------------------------------- challenges

/** The step between "password OK" and "code OK". Returns a raw token the
 *  browser holds in memory only; the database keeps its hash. */
export async function createChallenge(
  sql: Sql, args: { userId: string; tenantId: string; remember: boolean },
): Promise<string> {
  await sql`DELETE FROM mfa_challenges WHERE expires_at < now()`;
  const token = randomBytes(32).toString("hex");
  await sql`
    INSERT INTO mfa_challenges (user_id, tenant_id, token_hash, remember, expires_at)
    VALUES (${args.userId}, ${args.tenantId}, ${sha256(token)}, ${args.remember}, ${new Date(Date.now() + CHALLENGE_TTL_MS)})`;
  return token;
}

export type ChallengeResult =
  | { ok: true; userId: string; tenantId: string; remember: boolean; via: "app" | "recovery" }
  | { ok: false; reason: "invalid" | "unknown" | "expired" | "locked" | "unavailable" };

/** Verify the second factor for a challenge issued FOR THIS TENANT. A wrong
 *  code costs one of MAX_ATTEMPTS; after that the challenge is dead and the
 *  person must sign in with their password again. A right code deletes it. */
export async function verifyChallenge(
  sql: Sql, args: { token: string; tenantId: string; code: string; key: Buffer | null; now?: number },
): Promise<ChallengeResult> {
  const [c] = await sql`
    SELECT id, user_id, tenant_id, remember, attempts, expires_at FROM mfa_challenges
    WHERE token_hash = ${sha256(args.token)}`;
  // Not found, already used, or issued for another tenant: all look the same.
  if (!c || c.tenant_id !== args.tenantId) return { ok: false, reason: "unknown" };
  if (new Date(c.expires_at as string) < new Date()) {
    await sql`DELETE FROM mfa_challenges WHERE id = ${c.id as string}`;
    return { ok: false, reason: "expired" };
  }
  if (Number(c.attempts) >= MAX_ATTEMPTS) return { ok: false, reason: "locked" };
  if (!args.key) return { ok: false, reason: "unavailable" };

  const r = await consumeSecondFactor(sql, c.user_id as string, args.code, args.key, args.now);
  if (!r.ok) {
    await sql`UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = ${c.id as string}`;
    return { ok: false, reason: Number(c.attempts) + 1 >= MAX_ATTEMPTS ? "locked" : "invalid" };
  }
  await sql`DELETE FROM mfa_challenges WHERE id = ${c.id as string}`;
  return { ok: true, userId: c.user_id as string, tenantId: c.tenant_id as string, remember: c.remember as boolean, via: r.via };
}
