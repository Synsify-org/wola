// Roles & access: the invariants an administrator screen must never break.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { listAccess, changeRole, removeAccess, inviteToOrganisation, revokeInvite } from "../src/access-admin.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
let admin, app, T, T2;
const u = {};

const inTenant = (tenant, fn) =>
  app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenant}, true)`;
    return fn(tx);
  });

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 2 });
  await admin`DELETE FROM tenants WHERE slug IN ('acc-t','acc-t2')`;
  await admin`DELETE FROM users WHERE email LIKE '%@acc.t'`;
  const [t] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('acc-t','Acc','active') RETURNING id`;
  const [t2] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('acc-t2','Acc2','active') RETURNING id`;
  T = t.id; T2 = t2.id;

  const mk = async (email, role, tenant = T) => {
    const [x] = await admin`INSERT INTO users (email,name,status,password_hash) VALUES (${email},${email},'active','x') RETURNING id`;
    await admin`INSERT INTO memberships (tenant_id,user_id,role) VALUES (${tenant},${x.id},${role})`;
    return x.id;
  };
  u.admin1 = await mk("admin1@acc.t", "org_admin");
  u.admin2 = await mk("admin2@acc.t", "org_admin");
  u.staff = await mk("staff@acc.t", "employee");
  const [e] = await admin`INSERT INTO employees (tenant_id,user_id,employee_no,full_name,gross_salary,net_salary)
    VALUES (${T},${u.staff},'S1','Sam Staff',1000000,800000) RETURNING id`;
  u.staffEmp = e.id;
  await admin`INSERT INTO employees (tenant_id,employee_no,full_name,gross_salary,net_salary)
    VALUES (${T},'S2','No Login Yet',1000000,800000)`;
  // The same person also belongs to ANOTHER organisation.
  await admin`INSERT INTO memberships (tenant_id,user_id,role) VALUES (${T2},${u.staff},'employee')`;
  await admin`INSERT INTO sessions (user_id,tenant_id,token_hash,expires_at) VALUES (${u.staff},${T},'h-acc-1', now() + interval '1 day')`;
  await admin`INSERT INTO sessions (user_id,tenant_id,token_hash,expires_at) VALUES (${u.staff},${T2},'h-acc-2', now() + interval '1 day')`;
});

after(async () => {
  await app.end();
  await admin.end();
});

const actor = () => ({ tenantId: T, actorUserId: u.admin1 });

test("listing shows people with their linked employee, pending invites, and employees without a login", async () => {
  const o = await inTenant(T, (tx) => listAccess(tx, T));
  assert.deepEqual(o.people.map((p) => p.email).sort(), ["admin1@acc.t", "admin2@acc.t", "staff@acc.t"]);
  assert.equal(o.people.find((p) => p.email === "staff@acc.t").name, "Sam Staff");
  assert.deepEqual(o.employeesWithoutLogin.map((e) => e.name), ["No Login Yet"]);
});

test("changing a role leaves exactly one membership, and takes effect immediately", async () => {
  const r = await inTenant(T, (tx) => changeRole(tx, { ...actor(), targetUserId: u.staff, newRole: "hr" }));
  assert.equal(r.ok, true, r.error);
  const rows = await admin`SELECT role FROM memberships WHERE tenant_id = ${T} AND user_id = ${u.staff}`;
  assert.deepEqual(rows.map((x) => x.role), ["hr"]);
  const other = await admin`SELECT role FROM memberships WHERE tenant_id = ${T2} AND user_id = ${u.staff}`;
  assert.deepEqual(other.map((x) => x.role), ["employee"], "their role in another organisation is untouched");
});

test("you cannot change your own role, and invalid roles are refused", async () => {
  const self = await inTenant(T, (tx) => changeRole(tx, { ...actor(), targetUserId: u.admin1, newRole: "employee" }));
  assert.equal(self.ok, false);
  assert.match(self.error, /own role/);
  const bad = await inTenant(T, (tx) => changeRole(tx, { ...actor(), targetUserId: u.staff, newRole: "god" }));
  assert.equal(bad.ok, false);
});

test("the last administrator can't be demoted or removed", async () => {
  // Two admins: demoting one is fine.
  const ok = await inTenant(T, (tx) => changeRole(tx, { ...actor(), targetUserId: u.admin2, newRole: "auditor" }));
  assert.equal(ok.ok, true, ok.error);
  // admin1 is now the only admin. Another (non-admin) actor can't demote or remove them.
  const demote = await inTenant(T, (tx) => changeRole(tx, { tenantId: T, actorUserId: u.staff, targetUserId: u.admin1, newRole: "ceo" }));
  assert.equal(demote.ok, false);
  assert.match(demote.error, /only administrator/);
  const remove = await inTenant(T, (tx) => removeAccess(tx, { tenantId: T, actorUserId: u.staff, targetUserId: u.admin1 }));
  assert.equal(remove.ok, false);
  assert.match(remove.error, /only administrator/);
  // restore
  await inTenant(T, (tx) => changeRole(tx, { ...actor(), targetUserId: u.admin2, newRole: "org_admin" }));
});

test("removing access ends their sessions here only, unlinks the employee, and keeps the account", async () => {
  const r = await inTenant(T, (tx) => removeAccess(tx, { ...actor(), targetUserId: u.staff }));
  assert.equal(r.ok, true, r.error);
  assert.equal((await admin`SELECT 1 FROM memberships WHERE tenant_id = ${T} AND user_id = ${u.staff}`).length, 0);
  const sessions = await admin`SELECT tenant_id FROM sessions WHERE user_id = ${u.staff}`;
  assert.deepEqual(sessions.map((s) => s.tenant_id), [T2], "their session in the other organisation survives");
  const [emp] = await admin`SELECT user_id FROM employees WHERE id = ${u.staffEmp}`;
  assert.equal(emp.user_id, null, "HR can invite them again");
  assert.equal((await admin`SELECT 1 FROM users WHERE id = ${u.staff}`).length, 1, "the account itself remains");
  const self = await inTenant(T, (tx) => removeAccess(tx, { ...actor(), targetUserId: u.admin1 }));
  assert.equal(self.ok, false, "can't remove yourself");
});

test("inviting: validated, refuses existing members, and a newer invite replaces the older", async () => {
  const bad = await inTenant(T, (tx) => inviteToOrganisation(tx, { tenantId: T, invitedById: u.admin1, email: "nope", role: "employee" }));
  assert.equal(bad.ok, false);
  const member = await inTenant(T, (tx) => inviteToOrganisation(tx, { tenantId: T, invitedById: u.admin1, email: "ADMIN2@acc.t", role: "hr" }));
  assert.equal(member.ok, false);
  assert.match(member.error, /already has access/);

  const first = await inTenant(T, (tx) => inviteToOrganisation(tx, { tenantId: T, invitedById: u.admin1, email: "aud@acc.t", role: "auditor" }));
  assert.equal(first.ok, true, first.error);
  const second = await inTenant(T, (tx) => inviteToOrganisation(tx, { tenantId: T, invitedById: u.admin1, email: "aud@acc.t", role: "auditor" }));
  assert.equal(second.ok, true);
  const o = await inTenant(T, (tx) => listAccess(tx, T));
  assert.equal(o.invites.filter((i) => i.email === "aud@acc.t").length, 1, "only one live link");

  const revoked = await inTenant(T, (tx) => revokeInvite(tx, { tenantId: T, inviteId: o.invites[0].id }));
  assert.equal(revoked.ok, true);
  assert.equal((await inTenant(T, (tx) => listAccess(tx, T))).invites.length, 0);
});
