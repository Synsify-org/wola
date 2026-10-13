// Two-step sign-in. The TOTP maths is checked against RFC 6238's own test
// vectors (a wrong implementation would still "work" with itself); the database
// flows check the properties that matter for security: a code works once, wrong
// guesses are capped, recovery codes are single-use, a challenge only works for
// the tenant it was issued for, and secrets are encrypted at rest.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import {
  base32Encode, base32Decode, hotp, totpAt, verifyTotp, otpauthUri, encryptSecret, decryptSecret, mfaKey,
  normaliseRecoveryCode, newRecoveryCode, beginEnrollment, confirmEnrollment, getMfaStatus,
  createChallenge, verifyChallenge, consumeSecondFactor, disableMfa, replaceRecoveryCodes, MAX_ATTEMPTS,
} from "../src/mfa.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
let admin, app, T, T2, userId;
const key = randomBytes(32);

// RFC 6238 appendix B: SHA-1, secret "12345678901234567890", 8 digits.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

test("base32 round-trips and matches the RFC secret", () => {
  assert.equal(RFC_SECRET, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.equal(base32Decode(RFC_SECRET).toString(), "12345678901234567890");
  const r = randomBytes(20);
  assert.deepEqual(base32Decode(base32Encode(r)), r);
});

test("TOTP matches the RFC 6238 test vectors", () => {
  const secret = base32Decode(RFC_SECRET);
  const at = (t) => hotp(secret, Math.floor(t / 30), 8);
  assert.equal(at(59), "94287082");
  assert.equal(at(1111111109), "07081804");
  assert.equal(at(1111111111), "14050471");
  assert.equal(at(1234567890), "89005924");
  assert.equal(at(2000000000), "69279037");
  // The 6-digit code is the last 6 digits.
  assert.equal(totpAt(RFC_SECRET, 59_000), "287082");
});

test("verifyTotp accepts +/-1 step, rejects further drift, junk and replays", () => {
  const now = 1_700_000_000_000;
  const code = totpAt(RFC_SECRET, now);
  assert.deepEqual(verifyTotp(RFC_SECRET, code, { now }), { step: Math.floor(now / 30000) });
  assert.ok(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 30_000), { now }), "previous step (clock skew)");
  assert.ok(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now + 30_000), { now }), "next step (clock skew)");
  assert.equal(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 90_000), { now }), null, "3 steps old");
  assert.equal(verifyTotp(RFC_SECRET, "12345", { now }), null);
  assert.equal(verifyTotp(RFC_SECRET, "abcdef", { now }), null);
  assert.equal(verifyTotp(RFC_SECRET, code, { now, lastUsedStep: Math.floor(now / 30000) }), null, "replay");
  assert.ok(verifyTotp(RFC_SECRET, " " + code.slice(0, 3) + " " + code.slice(3), { now }), "spaces are tolerated");
});

test("the secret is encrypted at rest and tampering is detected", () => {
  const enc = encryptSecret(RFC_SECRET, key);
  assert.ok(!enc.includes(RFC_SECRET));
  assert.equal(decryptSecret(enc, key), RFC_SECRET);
  assert.notEqual(encryptSecret(RFC_SECRET, key), enc, "fresh IV each time");
  assert.throws(() => decryptSecret(enc, randomBytes(32)));
  const [iv, tag, ct] = enc.split(".");
  const flipped = Buffer.from(ct, "base64"); flipped[0] ^= 1;
  assert.throws(() => decryptSecret([iv, tag, flipped.toString("base64")].join("."), key));
});

test("the key must be exactly 32 bytes of base64, else MFA is unavailable", () => {
  assert.equal(mfaKey(undefined), null);
  assert.equal(mfaKey("short"), null);
  assert.equal(mfaKey(randomBytes(32).toString("base64"))?.length, 32);
});

test("recovery codes are readable, and typing them loosely still works", () => {
  const c = newRecoveryCode();
  assert.match(c, /^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
  assert.equal(normaliseRecoveryCode(c.toLowerCase().replace("-", " ")), c);
  assert.equal(normaliseRecoveryCode("short"), null);
});

test("otpauth URI carries the issuer, secret and parameters", () => {
  const u = otpauthUri("ceo@testco.io", RFC_SECRET);
  assert.match(u, /^otpauth:\/\/totp\/Wola%3Aceo%40testco\.io\?secret=GEZD/);
  assert.match(u, /issuer=Wola/);
  assert.match(u, /digits=6&period=30/);
});

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 2 });
  await admin`DELETE FROM tenants WHERE slug IN ('mfa-t','mfa-t2')`;
  await admin`DELETE FROM users WHERE email LIKE '%@mfa.t'`;
  const [t] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('mfa-t','Mfa','active') RETURNING id`;
  const [t2] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('mfa-t2','Mfa2','active') RETURNING id`;
  T = t.id; T2 = t2.id;
  const [u] = await admin`INSERT INTO users (email,name,status,password_hash) VALUES ('u@mfa.t','u','active','x') RETURNING id`;
  userId = u.id;
});
after(async () => { await app.end(); await admin.end(); });

let secret, recovery;

test("enrolment: not active until a valid code is shown; secret stored encrypted", async () => {
  assert.deepEqual(await getMfaStatus(app, userId), { enrolled: false, pending: false, recoveryCodesLeft: 0 });
  const b = await beginEnrollment(app, userId, key);
  assert.equal(b.ok, true);
  secret = b.secret;
  assert.equal((await getMfaStatus(app, userId)).pending, true);
  const [row] = await admin`SELECT secret_enc FROM user_mfa WHERE user_id = ${userId}`;
  assert.ok(!row.secret_enc.includes(secret), "no plaintext secret in the database");

  const bad = await confirmEnrollment(app, userId, "000000", key);
  assert.equal(bad.ok, false);
  const good = await confirmEnrollment(app, userId, totpAt(secret, Date.now()), key);
  assert.equal(good.ok, true, good.error);
  recovery = good.recoveryCodes;
  assert.equal(recovery.length, 10);
  assert.deepEqual(await getMfaStatus(app, userId), { enrolled: true, pending: false, recoveryCodesLeft: 10 });
  // Only hashes are stored.
  const stored = await admin`SELECT code_hash FROM mfa_recovery_codes WHERE user_id = ${userId}`;
  assert.ok(stored.every((r) => !recovery.includes(r.code_hash)));
  assert.equal((await beginEnrollment(app, userId, key)).ok, false, "can't restart while on");
});

test("sign-in: a right code works once; the same code again is a replay", async () => {
  // Use a step ahead of the one spent during enrolment.
  const future = Date.now() + 60_000;
  const code = totpAt(secret, future);
  const token = await createChallenge(app, { userId, tenantId: T, remember: true });
  const ok = await verifyChallenge(app, { token, tenantId: T, code, key, now: future });
  assert.equal(ok.ok, true);
  assert.equal(ok.remember, true);
  assert.equal(ok.via, "app");
  const t2 = await createChallenge(app, { userId, tenantId: T, remember: false });
  const replay = await verifyChallenge(app, { token: t2, tenantId: T, code, key, now: future });
  assert.equal(replay.ok, false, "a spent code can't be used again");
});

test("a challenge only works for its own tenant, and only once", async () => {
  const future = Date.now() + 120_000;
  const token = await createChallenge(app, { userId, tenantId: T, remember: false });
  const wrongTenant = await verifyChallenge(app, { token, tenantId: T2, code: totpAt(secret, future), key, now: future });
  assert.deepEqual(wrongTenant, { ok: false, reason: "unknown" });
  const ok = await verifyChallenge(app, { token, tenantId: T, code: totpAt(secret, future), key, now: future });
  assert.equal(ok.ok, true);
  const again = await verifyChallenge(app, { token, tenantId: T, code: totpAt(secret, future + 30_000), key, now: future + 30_000 });
  assert.deepEqual(again, { ok: false, reason: "unknown" }, "the challenge is consumed");
});

test("a platform (super-admin) challenge and a tenant challenge can never unlock each other", async () => {
  const future = Date.now() + 400_000;
  const platform = await createChallenge(app, { userId, tenantId: null, remember: false });
  const asTenant = await verifyChallenge(app, { token: platform, tenantId: T, code: totpAt(secret, future), key, now: future });
  assert.deepEqual(asTenant, { ok: false, reason: "unknown" }, "a platform challenge is useless on a tenant");
  const ok = await verifyChallenge(app, { token: platform, tenantId: null, code: totpAt(secret, future), key, now: future });
  assert.equal(ok.ok, true);
  assert.equal(ok.tenantId, null);

  const tenant = await createChallenge(app, { userId, tenantId: T, remember: false });
  const asPlatform = await verifyChallenge(app, { token: tenant, tenantId: null, code: totpAt(secret, future + 30_000), key, now: future + 30_000 });
  assert.deepEqual(asPlatform, { ok: false, reason: "unknown" }, "a tenant challenge can't open the platform console");
});

test("wrong guesses are capped: after MAX_ATTEMPTS even the right code is refused", async () => {
  const token = await createChallenge(app, { userId, tenantId: T, remember: false });
  let last;
  for (let i = 0; i < MAX_ATTEMPTS; i++) last = await verifyChallenge(app, { token, tenantId: T, code: "000000", key });
  assert.deepEqual(last, { ok: false, reason: "locked" });
  const future = Date.now() + 200_000;
  const afterLock = await verifyChallenge(app, { token, tenantId: T, code: totpAt(secret, future), key, now: future });
  assert.deepEqual(afterLock, { ok: false, reason: "locked" });
});

test("an expired challenge is refused and removed", async () => {
  const token = await createChallenge(app, { userId, tenantId: T, remember: false });
  await admin`UPDATE mfa_challenges SET expires_at = now() - interval '1 minute' WHERE user_id = ${userId}`;
  const r = await verifyChallenge(app, { token, tenantId: T, code: "000000", key });
  assert.deepEqual(r, { ok: false, reason: "expired" });
});

test("no key configured: sign-in fails closed rather than skipping the second step", async () => {
  const token = await createChallenge(app, { userId, tenantId: T, remember: false });
  const r = await verifyChallenge(app, { token, tenantId: T, code: "123456", key: null });
  assert.deepEqual(r, { ok: false, reason: "unavailable" });
});

test("recovery codes work exactly once", async () => {
  const code = recovery[0];
  const first = await consumeSecondFactor(app, userId, code.toLowerCase(), key);
  assert.deepEqual(first, { ok: true, via: "recovery" });
  const second = await consumeSecondFactor(app, userId, code, key);
  assert.deepEqual(second, { ok: false });
  assert.equal((await getMfaStatus(app, userId)).recoveryCodesLeft, 9);
});

test("new recovery codes invalidate the old ones; turning off removes everything", async () => {
  const fresh = await replaceRecoveryCodes(app, userId);
  assert.equal(fresh.length, 10);
  assert.deepEqual(await consumeSecondFactor(app, userId, recovery[1], key), { ok: false }, "old code is dead");
  assert.equal((await consumeSecondFactor(app, userId, fresh[0], key)).ok, true);

  await disableMfa(app, userId);
  assert.deepEqual(await getMfaStatus(app, userId), { enrolled: false, pending: false, recoveryCodesLeft: 0 });
  assert.equal((await admin`SELECT 1 FROM user_mfa WHERE user_id = ${userId}`).length, 0);
});

test("the Data API roles can't read these tables (RLS lockout like the other global tables)", async () => {
  const rows = await admin`SELECT relrowsecurity FROM pg_class WHERE relname IN ('user_mfa','mfa_recovery_codes','mfa_challenges')`;
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.relrowsecurity === true));
});
