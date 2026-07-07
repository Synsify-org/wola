// packages/db/test/config_isolation.test.mjs
// Isolation proof for the 0002 config-layer tables. Every new tenant
// table MUST appear here — untested RLS is unproven RLS.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
let app, admin, A, B;

const inTenant = (tenantId, fn) =>
  app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });

before(async () => {
  admin = postgres(ADMIN_URL, { max: 1 });
  app = postgres(APP_URL, { max: 2 });
  // Clean only THIS file's data, children before parents, scoped by slug.
  await admin`DELETE FROM approval_stages    WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('cfg-a','cfg-b'))`;
  await admin`DELETE FROM approval_pipelines WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('cfg-a','cfg-b'))`;
  await admin`DELETE FROM loan_products      WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('cfg-a','cfg-b'))`;
  await admin`DELETE FROM rate_indices       WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('cfg-a','cfg-b'))`;
  await admin`DELETE FROM tenants WHERE slug IN ('cfg-a','cfg-b')`;
  [A] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('cfg-a','Config A','active') RETURNING id`;
  [B] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('cfg-b','Config B','active') RETURNING id`;
  await admin`INSERT INTO loan_products (tenant_id,name,kind) VALUES
    (${A.id},'Salary Advance','advance'), (${B.id},'Dev Loan','term')`;
});

after(async () => { await app.end(); await admin.end(); });

test("loan_products: tenant A sees only its own", async () => {
  const rows = await inTenant(A.id, (tx) => tx`SELECT name FROM loan_products`);
  assert.deepEqual(rows.map(r => r.name), ["Salary Advance"]);
});

test("loan_products: cross-tenant INSERT rejected", async () => {
  await assert.rejects(
    inTenant(A.id, (tx) => tx`INSERT INTO loan_products (tenant_id,name,kind)
      VALUES (${B.id},'Sneaky','advance')`),
    /row-level security/i,
  );
});

test("loan_products: no context => zero rows", async () => {
  assert.equal((await app`SELECT * FROM loan_products`).length, 0);
});

test("rate_indices: isolated by tenant", async () => {
  await inTenant(A.id, (tx) => tx`INSERT INTO rate_indices (tenant_id,name,current_value)
    VALUES (${A.id},'CBR',9.5)`);
  const rows = await inTenant(B.id, (tx) => tx`SELECT * FROM rate_indices`);
  assert.equal(rows.length, 0);
});

test("approval_pipelines + stages: isolated by tenant", async () => {
  const [prod] = await inTenant(A.id, (tx) =>
    tx`SELECT id FROM loan_products WHERE name='Salary Advance'`);
  const [pipe] = await inTenant(A.id, (tx) =>
    tx`INSERT INTO approval_pipelines (tenant_id,loan_product_id)
       VALUES (${A.id},${prod.id}) RETURNING id`);
  await inTenant(A.id, (tx) => tx`INSERT INTO approval_stages
    (tenant_id,pipeline_id,position,approver_role)
    VALUES (${A.id},${pipe.id},1,'hr')`);
  const seenByB = await inTenant(B.id, (tx) => tx`SELECT * FROM approval_stages`);
  assert.equal(seenByB.length, 0);
});