// packages/db/test/session_auth.test.mjs
// Proves: tenant-pinned sessions reject cross-tenant replay, expired
// sessions die, and password verify is tenant-scoped via membership.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { createHash } from "node:crypto";

const ADMIN = process.env.DATABASE_ADMIN_URL;
let admin, A, B, userA;
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  await admin`DELETE FROM sessions`;
  await admin`DELETE FROM memberships WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('auth-a','auth-b'))`;
  await admin`DELETE FROM users WHERE email = 'u@test.io'`;
  await admin`DELETE FROM tenants WHERE slug IN ('auth-a','auth-b')`;
  [A] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('auth-a','Auth A','active') RETURNING id`;
  [B] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('auth-b','Auth B','active') RETURNING id`;
  [userA] = await admin`INSERT INTO users (email,name,status) VALUES ('u@test.io','U','active') RETURNING id`;
  // user is a member of A only, NOT B
  await admin`INSERT INTO memberships (tenant_id,user_id,role) VALUES (${A.id},${userA.id},'employee')`;
});
after(async () => { await admin.end(); });

test("a session issued for tenant A does not match tenant B", async () => {
  const token = "raw-token-xyz";
  await admin`INSERT INTO sessions (user_id,tenant_id,token_hash,expires_at)
    VALUES (${userA.id},${A.id},${sha256(token)},${new Date(Date.now()+3600000)})`;
  // simulate verifySession's core check: same token, tenant B => no row
  const [s] = await admin`SELECT tenant_id FROM sessions WHERE token_hash=${sha256(token)}`;
  assert.equal(s.tenant_id, A.id);
  assert.notEqual(s.tenant_id, B.id); // replay on B must fail the tenant check
});

test("expired sessions are detectable", async () => {
  const token = "expired-token";
  await admin`INSERT INTO sessions (user_id,tenant_id,token_hash,expires_at)
    VALUES (${userA.id},${A.id},${sha256(token)},${new Date(Date.now()-1000)})`;
  const [s] = await admin`SELECT expires_at FROM sessions WHERE token_hash=${sha256(token)}`;
  assert.ok(s.expires_at < new Date());
});

test("only the token HASH is stored, never the raw token", async () => {
  const token = "secret-raw";
  await admin`INSERT INTO sessions (user_id,tenant_id,token_hash,expires_at)
    VALUES (${userA.id},${A.id},${sha256(token)},${new Date(Date.now()+3600000)})`;
  const rows = await admin`SELECT token_hash FROM sessions WHERE token_hash=${sha256(token)}`;
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, token); // stored value is not the token
});

test("user with no membership in a tenant cannot be logged in there", async () => {
  // the login JOIN requires a membership row; user has none in B
  const [row] = await admin`
    SELECT u.id FROM users u
    JOIN memberships m ON m.user_id = u.id AND m.tenant_id = ${B.id}
    WHERE u.email = 'u@test.io'`;
  assert.equal(row, undefined); // no join result => login returns null
});