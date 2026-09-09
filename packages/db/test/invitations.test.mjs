// packages/db/test/invitations.test.mjs
// Proves the invite flow (spec §7.4) end to end against a real database:
// issuing, expiry/replay rejection, and the two acceptance paths — a brand
// new identity (sets a password) and an email that already has a Wola
// account elsewhere (just adds the membership, no password needed).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { createHash } from "node:crypto";
import { createInvitation, loadInvitation, acceptInvitation } from "../src/invitations.ts";
import { verifyPassword } from "../src/auth.ts";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
let admin, app, T, T2;
const ids = {};

const inTenant = (tid, fn) =>
  app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tid}, true)`;
    return fn(tx);
  });

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 2 });

  await admin`DELETE FROM invitations WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('inv-a','inv-b'))`;
  await admin`DELETE FROM memberships WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('inv-a','inv-b'))`;
  await admin`DELETE FROM employees WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('inv-a','inv-b'))`;
  await admin`DELETE FROM tenants WHERE slug IN ('inv-a','inv-b')`;
  await admin`DELETE FROM users WHERE email LIKE '%@inv.t'`;

  const [t1] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('inv-a','Inv A','active') RETURNING id`;
  const [t2] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('inv-b','Inv B','active') RETURNING id`;
  T = t1.id; T2 = t2.id;

  const [inviter] = await admin`INSERT INTO users (email,name,status,password_hash)
    VALUES ('inviter@inv.t','Inviter','active','x') RETURNING id`;
  ids.inviterId = inviter.id;

  const [emp] = await admin`INSERT INTO employees
    (tenant_id,employee_no,full_name,gross_salary,net_salary)
    VALUES (${T},'E1','New Hire',3000000,2500000) RETURNING id`;
  ids.employeeId = emp.id;
});

after(async () => { await app.end(); await admin.end(); });

test("creates an invitation with the given role, tied to the tenant", async () => {
  const issued = await inTenant(T, (tx) => createInvitation(tx, {
    tenantId: T, email: "newhire@inv.t", role: "employee",
    employeeId: ids.employeeId, invitedById: ids.inviterId,
  }));
  assert.ok(issued.token);
  assert.ok(issued.expires > new Date());

  const inv = await loadInvitation(app, issued.token);
  assert.equal(inv.tenantId, T);
  assert.equal(inv.email, "newhire@inv.t");
  assert.equal(inv.role, "employee");
  assert.equal(inv.existingUserId, null);
});

test("refuses to invite an employee who already has a login", async () => {
  const [user] = await admin`INSERT INTO users (email,name,status,password_hash)
    VALUES ('already@inv.t','Already','active','x') RETURNING id`;
  const [emp] = await admin`INSERT INTO employees
    (tenant_id,employee_no,full_name,gross_salary,net_salary,user_id)
    VALUES (${T},'E2','Already Has Login',3000000,2500000,${user.id}) RETURNING id`;

  await assert.rejects(
    () => inTenant(T, (tx) => createInvitation(tx, {
      tenantId: T, email: "already@inv.t", role: "employee",
      employeeId: emp.id, invitedById: ids.inviterId,
    })),
    /already has a login/,
  );
});

test("an unknown, expired, or already-accepted token loads as null", async () => {
  assert.equal(await loadInvitation(app, "not-a-real-token"), null);

  // Real matching hashes this time, so loadInvitation actually reaches (and
  // is proven by) its expiry/accepted_at checks, not just a hash miss.
  const expiredToken = "expired-raw-token";
  await admin`INSERT INTO invitations
    (tenant_id,email,role,token_hash,expires_at)
    VALUES (${T},'expired@inv.t','employee',${sha256(expiredToken)},now() - interval '1 hour')`;
  assert.equal(await loadInvitation(app, expiredToken), null);

  const usedToken = "already-used-raw-token";
  await admin`INSERT INTO invitations
    (tenant_id,email,role,token_hash,expires_at,accepted_at)
    VALUES (${T},'used@inv.t','employee',${sha256(usedToken)},now() + interval '1 day',now())`;
  assert.equal(await loadInvitation(app, usedToken), null);
});

test("accepting with a new email creates the user, grants membership, and links the employee", async () => {
  const issued = await inTenant(T, (tx) => createInvitation(tx, {
    tenantId: T, email: "newhire@inv.t", role: "employee",
    employeeId: ids.employeeId, invitedById: ids.inviterId,
  }));

  const short = await acceptInvitation(app, issued.token, "short");
  assert.equal(short.ok, false, "passwords under 8 chars must be rejected");

  const result = await acceptInvitation(app, issued.token, "a-real-password-123");
  assert.equal(result.ok, true);
  assert.equal(result.tenantId, T);

  const [user] = await admin`SELECT password_hash FROM users WHERE id = ${result.userId}`;
  assert.ok(await verifyPassword(user.password_hash, "a-real-password-123"));

  const [membership] = await admin`SELECT role FROM memberships WHERE tenant_id = ${T} AND user_id = ${result.userId}`;
  assert.equal(membership.role, "employee");

  const [emp] = await admin`SELECT user_id FROM employees WHERE id = ${ids.employeeId}`;
  assert.equal(emp.user_id, result.userId);

  // replay is refused — the invitation is now accepted
  const replay = await acceptInvitation(app, issued.token, "a-real-password-123");
  assert.equal(replay.ok, false);
});

test("accepting with an email that already has a Wola account needs no password, adds a membership to the new tenant only", async () => {
  const [existing] = await admin`INSERT INTO users (email,name,status,password_hash)
    VALUES ('crosstenant@inv.t','Cross Tenant','active','$argon2id$existing-hash') RETURNING id`;
  // Already a member of tenant T2, not T.
  await admin`INSERT INTO memberships (tenant_id,user_id,role) VALUES (${T2},${existing.id},'employee')`;

  const issued = await inTenant(T, (tx) => createInvitation(tx, {
    tenantId: T, email: "crosstenant@inv.t", role: "hr", invitedById: ids.inviterId,
  }));

  const inv = await loadInvitation(app, issued.token);
  assert.equal(inv.existingUserId, existing.id);

  const result = await acceptInvitation(app, issued.token, null);
  assert.equal(result.ok, true);
  assert.equal(result.userId, existing.id, "must reuse the existing global identity, not create a second one");

  const memberships = await admin`SELECT tenant_id, role FROM memberships WHERE user_id = ${existing.id} ORDER BY tenant_id`;
  assert.equal(memberships.length, 2, "existing T2 membership must be untouched, T added alongside it");
  const forT = memberships.find((m) => m.tenant_id === T);
  assert.equal(forT.role, "hr");

  // Password hash is untouched — this identity keeps its own password.
  const [user] = await admin`SELECT password_hash FROM users WHERE id = ${existing.id}`;
  assert.equal(user.password_hash, "$argon2id$existing-hash");
});
