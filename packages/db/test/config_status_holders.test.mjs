// An approval step nobody can act on is reported (the group-CEO situation), by role, with the products
// and whose applications reach it; it clears when someone is given that role.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { configurationStatus } from "../src/config-status.ts";
import { tenantTx } from "../src/client.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL, APP = process.env.DATABASE_URL;
let admin, app, T;
const status = () => tenantTx(app, T, (tx) => configurationStatus(tx, T));

before(async () => {
  admin = postgres(ADMIN, { max: 1 }); app = postgres(APP, { max: 2 });
  await admin`DELETE FROM tenants WHERE slug = 'hold-t'`;
  await admin`DELETE FROM users WHERE email LIKE '%@hold.t'`;
  [{ id: T }] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('hold-t','Holders','active') RETURNING id`;
  const [dev] = await admin`INSERT INTO loan_products (tenant_id,name,kind) VALUES (${T},'Development Loan','term') RETURNING id`;
  const [adv] = await admin`INSERT INTO loan_products (tenant_id,name,kind) VALUES (${T},'Salary Advance','advance') RETURNING id`;
  const chain = async (product, appliesTo, roles) => {
    const [p] = await admin`INSERT INTO approval_pipelines (tenant_id,loan_product_id,applies_to) VALUES (${T},${product},${appliesTo}) RETURNING id`;
    for (const [i, role] of roles.entries()) await admin`INSERT INTO approval_stages (tenant_id,pipeline_id,position,approver_role) VALUES (${T},${p.id},${i + 1},${role})`;
  };
  await chain(dev.id, "default", ["dept_head", "hr", "cfo", "ceo"]);
  await chain(dev.id, "ceo", ["hr", "cfo", "coo", "group_ceo"]);
  await chain(adv.id, "default", ["hr", "cfo"]);
  const user = async (role) => { const [u] = await admin`INSERT INTO users (email,name,status,password_hash) VALUES (${role + "@hold.t"},${role},'active','x') RETURNING id`; await admin`INSERT INTO memberships (tenant_id,user_id,role) VALUES (${T},${u.id},${role})`; };
  for (const r of ["dept_head", "hr", "cfo", "ceo"]) await user(r);
});
after(async () => { await admin`DELETE FROM tenants WHERE slug = 'hold-t'`; await admin`DELETE FROM users WHERE email LIKE '%@hold.t'`; await app.end(); await admin.end(); });

test("steps nobody holds the role for are reported, with the products and whose loans reach them", async () => {
  const s = await status();
  const byRole = Object.fromEntries(s.stagesWithoutHolder.map((x) => [x.role, x]));
  assert.deepEqual(Object.keys(byRole).sort(), ["coo", "group_ceo"]);
  assert.deepEqual(byRole.group_ceo.products, ["Development Loan"]);
  assert.deepEqual(byRole.group_ceo.appliesTo, ["ceo"], "only loans applied for by the CEO reach it");
  assert.deepEqual(byRole.coo.appliesTo, ["ceo"]);
});

test("giving someone the role clears the warning for that role only", async () => {
  const [u] = await admin`INSERT INTO users (email,name,status,password_hash) VALUES ('gceo@hold.t','Group','active','x') RETURNING id`;
  await admin`INSERT INTO memberships (tenant_id,user_id,role) VALUES (${T},${u.id},'group_ceo')`;
  const s = await status();
  assert.deepEqual(s.stagesWithoutHolder.map((x) => x.role), ["coo"]);
});

test("a retired step is no longer reported", async () => {
  await admin`UPDATE approval_stages SET retired_at = now() WHERE tenant_id = ${T} AND approver_role = 'coo'`;
  assert.deepEqual((await status()).stagesWithoutHolder, []);
});
