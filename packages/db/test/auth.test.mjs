// packages/db/test/auth.test.mjs — Tier 1.2 (WOLA_BUILD_SPEC.md Feature 1.2).
//
// Two of the spec's test cases are genuinely Next.js-integration concerns
// (the real login() cookie flow, the real HTTP 401 after logout) that this
// repo has no e2e harness for — same pre-existing gap DECISIONS.md already
// flags for the OLD auth code, not something introduced here. What IS
// tested here is every building block those behaviors are built from:
// password verification, session deletion, rate-limit counting, and the
// reset-token lifecycle — at the real DB level, not mocked.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import {
  hashPassword, verifyPassword,
  isRateLimited, recordLoginAttempt,
  createPasswordReset, resetPassword,
} from "../src/auth.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
let admin, app, A, B, userA;

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 2 });

  await admin`DELETE FROM login_attempts WHERE email LIKE '%@pwr.t'`;
  await admin`DELETE FROM password_resets WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@pwr.t')`;
  await admin`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@pwr.t')`;
  await admin`DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@pwr.t')`;
  await admin`DELETE FROM users WHERE email LIKE '%@pwr.t'`;
  await admin`DELETE FROM tenants WHERE slug IN ('pwr-a','pwr-b')`;

  [A] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('pwr-a','Pwr A','active') RETURNING id`;
  [B] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('pwr-b','Pwr B','active') RETURNING id`;

  const hash = await hashPassword("correct-horse-battery-staple");
  [userA] = await admin`INSERT INTO users (email, name, status, password_hash)
    VALUES ('grace@pwr.t', 'Grace', 'active', ${hash}) RETURNING id`;
  await admin`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${A.id}, ${userA.id}, 'employee')`;
});
after(async () => { await app.end(); await admin.end(); });

test("verifyPassword accepts the correct password and rejects a wrong one", async () => {
  const hash = await hashPassword("correct-horse-battery-staple");
  assert.equal(await verifyPassword(hash, "correct-horse-battery-staple"), true);
  assert.equal(await verifyPassword(hash, "wrong-password"), false);
});

test("createPasswordReset returns null for an email with no membership in this tenant", async () => {
  const issued = await createPasswordReset(admin, "grace@pwr.t", B.id); // B, not A
  assert.equal(issued, null);
});

test("createPasswordReset returns null for a non-existent email (same shape as success — no enumeration)", async () => {
  const issued = await createPasswordReset(admin, "nobody@pwr.t", A.id);
  assert.equal(issued, null);
});

test("a valid reset token sets a new password and then cannot be reused", async () => {
  const issued = await createPasswordReset(admin, "grace@pwr.t", A.id);
  assert.ok(issued);

  const first = await resetPassword(admin, issued.token, "brand-new-password-1");
  assert.equal(first.ok, true);

  const [u] = await admin`SELECT password_hash FROM users WHERE id = ${userA.id}`;
  assert.equal(await verifyPassword(u.password_hash, "brand-new-password-1"), true);

  const replay = await resetPassword(admin, issued.token, "another-password-2");
  assert.equal(replay.ok, false);
  assert.match(replay.error, /already been used/);
});

test("an expired reset token is rejected", async () => {
  const issued = await createPasswordReset(admin, "grace@pwr.t", A.id);
  // Back-date it past its TTL directly — proves the expiry check, not the clock.
  await admin`UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE token_hash = (
    SELECT token_hash FROM password_resets ORDER BY created_at DESC LIMIT 1
  )`;
  const result = await resetPassword(admin, issued.token, "irrelevant-password");
  assert.equal(result.ok, false);
  assert.match(result.error, /expired/);
});

test("a completed reset deletes every existing session for that user", async () => {
  await admin`INSERT INTO sessions (user_id, tenant_id, token_hash, expires_at)
    VALUES (${userA.id}, ${A.id}, 'deadbeef', now() + interval '1 hour')`;
  const issued = await createPasswordReset(admin, "grace@pwr.t", A.id);
  await resetPassword(admin, issued.token, "yet-another-password-3");

  const remaining = await admin`SELECT id FROM sessions WHERE user_id = ${userA.id}`;
  assert.equal(remaining.length, 0);
});

test("the 6th login attempt within 15 minutes is rate-limited, the first 5 are not", async () => {
  const email = "ratelimited@pwr.t";
  const ip = "203.0.113.7";
  for (let i = 0; i < 5; i++) {
    assert.equal(await isRateLimited(admin, email, ip), false, `attempt ${i + 1} should not be limited yet`);
    await recordLoginAttempt(admin, email, ip);
  }
  assert.equal(await isRateLimited(admin, email, ip), true);
});

test("rate limiting is per (email, ip) pair — a different ip is not limited by the same email's attempts", async () => {
  const email = "pairtest@pwr.t";
  for (let i = 0; i < 5; i++) await recordLoginAttempt(admin, email, "203.0.113.1");
  assert.equal(await isRateLimited(admin, email, "203.0.113.1"), true);
  assert.equal(await isRateLimited(admin, email, "203.0.113.2"), false);
});

test("attempts older than the 15-minute window don't count toward the limit", async () => {
  const email = "stale@pwr.t";
  const ip = "203.0.113.9";
  await admin`INSERT INTO login_attempts (email, ip, created_at)
    SELECT ${email}, ${ip}, now() - interval '20 minutes' FROM generate_series(1, 5)`;
  assert.equal(await isRateLimited(admin, email, ip), false);
});
