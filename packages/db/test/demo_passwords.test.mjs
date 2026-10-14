// New demo passwords: the SQL is run against a real database and the new password signs in; the old
// one and any old session stop working.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { createHash } from "node:crypto";
import { passwordSql, newPassword } from "../../../scripts/lib/demo-passwords.mjs";
import { verifyPassword, hashPassword } from "../src/auth.ts";

let admin, T;
before(async () => {
  admin = postgres(process.env.DATABASE_ADMIN_URL, { max: 1 });
  await admin`DELETE FROM tenants WHERE slug = 'dpw-t'`;
  await admin`DELETE FROM users WHERE email LIKE '%@dpw.t'`;
  [{ id: T }] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('dpw-t','Dpw','active') RETURNING id`;
  for (const n of ["a", "b", "other"]) {
    const [u] = await admin`INSERT INTO users (email,name,status,password_hash) VALUES (${n + "@dpw.t"},${n},'active',${await hashPassword("test1234")}) RETURNING id`;
    await admin`INSERT INTO sessions (user_id,tenant_id,token_hash,expires_at) VALUES (${u.id},${T},${createHash("sha256").update(n).digest("hex")},now() + interval '1 day')`;
  }
});
after(async () => { await admin`DELETE FROM tenants WHERE slug = 'dpw-t'`; await admin`DELETE FROM users WHERE email LIKE '%@dpw.t'`; await admin.end(); });

test("new passwords work, the old one does not, sessions end, and accounts not named are untouched", async () => {
  const { sql, passwords } = await passwordSql(["A@dpw.t", "b@dpw.t", "a@dpw.t", "missing@dpw.t"]);
  assert.equal(passwords.length, 3, "duplicates (any case) collapse to one");
  const rows = await admin.unsafe(sql); // one statement: the rows come back directly
  assert.deepEqual(rows.map((r) => r.updated_account), ["a@dpw.t", "b@dpw.t"], "an address that does not exist is simply not changed");

  const hashOf = async (e) => (await admin`SELECT password_hash FROM users WHERE email = ${e}`)[0].password_hash;
  for (const p of passwords.filter((x) => x.email !== "missing@dpw.t")) {
    assert.ok(await verifyPassword(await hashOf(p.email), p.password), `${p.email} signs in with the new password`);
    assert.equal(await verifyPassword(await hashOf(p.email), "test1234"), false, `${p.email} no longer accepts the old one`);
  }
  assert.ok(await verifyPassword(await hashOf("other@dpw.t"), "test1234"), "an account that was not named keeps its password");
  const s = await admin`SELECT u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email LIKE '%@dpw.t'`;
  assert.deepEqual(s.map((r) => r.email), ["other@dpw.t"], "named accounts were signed out; the other was not");
});

test("passwords are random, long enough and free of look-alike characters; bad input is refused", async () => {
  const seen = new Set(Array.from({ length: 200 }, () => newPassword()));
  assert.equal(seen.size, 200);
  for (const p of seen) { assert.equal(p.length, 14); assert.doesNotMatch(p, /[0OolI1]/); }
  await assert.rejects(passwordSql([]), /No email/);
  await assert.rejects(passwordSql(["nope"]), /valid email/);
  const one = await passwordSql(["x@dpw.t"]);
  assert.ok(!one.sql.includes(one.passwords[0].password), "the SQL holds hashes, never the password");
});
