// packages/db/test/isolation.test.mjs
// The most important tests in the company. Run on every PR.
// Connects as wola_app (the runtime role) and tries to break isolation.
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
  // Scope EVERY cleanup to this file's tenants. Bare DELETEs destroy the dev
  // fixtures (testco) and other test files' data — users/employees/audit_log
  // are not protected by any tenant convention here.
  await admin`DELETE FROM audit_log WHERE tenant_id IN
    (SELECT id FROM tenants WHERE slug IN ('acme','umoja'))`;
  await admin`DELETE FROM employees WHERE tenant_id IN
    (SELECT id FROM tenants WHERE slug IN ('acme','umoja'))`;
// users is GLOBAL (no tenant_id) — a bare DELETE destroys the dev login
  // users and every other test's fixtures. Scope to THIS file's data only.
  await admin`DELETE FROM memberships WHERE tenant_id IN
    (SELECT id FROM tenants WHERE slug IN ('acme','umoja'))`;
  await admin`DELETE FROM users WHERE email LIKE '%@iso.t'`;
  // was: await admin`DELETE FROM tenants`;
  await admin`DELETE FROM tenants WHERE slug IN ('acme','umoja')`;
  [A] = await admin`INSERT INTO tenants (slug, name, status) VALUES ('acme','Acme Ltd','active') RETURNING id`;
  [B] = await admin`INSERT INTO tenants (slug, name, status) VALUES ('umoja','Umoja SACCO','active') RETURNING id`;
  await admin`INSERT INTO employees (tenant_id, employee_no, full_name, gross_salary, net_salary)
    VALUES (${A.id},'A-001','Alice A',5000000,3500000),
           (${A.id},'A-002','Andrew A',4000000,2900000),
           (${B.id},'B-001','Brenda B',6000000,4100000)`;
});

after(async () => { await app.end(); await admin.end(); });

test("tenant A sees only its own employees", async () => {
  const rows = await inTenant(A.id, (tx) => tx`SELECT employee_no FROM employees ORDER BY employee_no`);
  assert.deepEqual(rows.map(r => r.employee_no), ["A-001", "A-002"]);
});

test("no tenant context => zero rows, not an error leak", async () => {
  const rows = await app`SELECT * FROM employees`;
  assert.equal(rows.length, 0);
});

test("cross-tenant INSERT is rejected by WITH CHECK", async () => {
  await assert.rejects(
    inTenant(A.id, (tx) => tx`INSERT INTO employees (tenant_id, employee_no, full_name, gross_salary, net_salary)
      VALUES (${B.id},'EVIL-1','Mallory',1,1)`),
    /row-level security/i,
  );
});

test("cross-tenant UPDATE touches zero rows", async () => {
  const res = await inTenant(A.id, (tx) => tx`UPDATE employees SET gross_salary = 1 WHERE tenant_id = ${B.id}`);
  assert.equal(res.count, 0);
  const [check] = await admin`SELECT gross_salary FROM employees WHERE employee_no = 'B-001'`;
  assert.equal(Number(check.gross_salary), 6000000);
});

test("cross-tenant DELETE touches zero rows", async () => {
  const res = await inTenant(A.id, (tx) => tx`DELETE FROM employees WHERE tenant_id = ${B.id}`);
  assert.equal(res.count, 0);
});

test("smuggling a foreign tenant_id via WHERE still returns nothing", async () => {
  const rows = await inTenant(A.id, (tx) => tx`SELECT * FROM employees WHERE tenant_id = ${B.id}`);
  assert.equal(rows.length, 0);
});

test("tenant context does not leak across pooled connections", async () => {
  await inTenant(A.id, (tx) => tx`SELECT 1`);
  const rows = await app`SELECT * FROM employees`; // fresh, contextless
  assert.equal(rows.length, 0);
});

test("audit log is append-only for the app role", async () => {
  await inTenant(A.id, (tx) => tx`INSERT INTO audit_log (tenant_id, action, entity)
    VALUES (${A.id},'test.write','employees')`);
  await assert.rejects(
    inTenant(A.id, (tx) => tx`DELETE FROM audit_log WHERE tenant_id = ${A.id}`),
    /permission denied/i,
  );
  await assert.rejects(
    inTenant(A.id, (tx) => tx`UPDATE audit_log SET action = 'tampered' WHERE tenant_id = ${A.id}`),
    /permission denied/i,
  );
});

test("reserved subdomains cannot become tenants", async () => {
  await assert.rejects(
    admin`INSERT INTO tenants (slug, name) VALUES ('api','Sneaky Co')`,
    /slug_reserved/,
  );
  await assert.rejects(
    admin`INSERT INTO tenants (slug, name) VALUES ('Bad_Slug!','Bad Co')`,
    /slug_format/,
  );
});

test("app role cannot create tables (no DDL)", async () => {
  await assert.rejects(app`CREATE TABLE hax (id int)`, /permission denied/i);
});
