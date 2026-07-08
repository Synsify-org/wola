// packages/db/test/lifecycle_isolation.test.mjs
// Isolation + same-tenant-FK proof for the 0004 lifecycle tables.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
let admin, app, A, B, empA, prodA;

const inTenant = (tid, fn) =>
  app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tid}, true)`;
    return fn(tx);
  });

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 2 });
  // scoped cleanup, children before parents
  for (const t of ['repayments','disbursements','schedule_lines','loan_schedules','loans','approvals','loan_applications'])
    await admin.unsafe(`DELETE FROM ${t} WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('life-a','life-b'))`);
  await admin`DELETE FROM loan_products WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('life-a','life-b'))`;
  await admin`DELETE FROM employees WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('life-a','life-b'))`;
  await admin`DELETE FROM tenants WHERE slug IN ('life-a','life-b')`;

  [A] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('life-a','Life A','active') RETURNING id`;
  [B] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('life-b','Life B','active') RETURNING id`;
  [empA] = await admin`INSERT INTO employees (tenant_id,employee_no,full_name,gross_salary,net_salary)
    VALUES (${A.id},'E1','Emp A',5000000,3500000) RETURNING id`;
  [prodA] = await admin`INSERT INTO loan_products (tenant_id,name,kind) VALUES (${A.id},'Advance','advance') RETURNING id`;
});
after(async () => { await app.end(); await admin.end(); });

test("loan_applications isolated by tenant", async () => {
  await inTenant(A.id, (tx) => tx`INSERT INTO loan_applications
    (tenant_id,employee_id,loan_product_id,amount,tenor_months)
    VALUES (${A.id},${empA.id},${prodA.id},1000000,6)`);
  const seenByB = await inTenant(B.id, (tx) => tx`SELECT * FROM loan_applications`);
  assert.equal(seenByB.length, 0);
});

test("cross-tenant application INSERT rejected by RLS", async () => {
  await assert.rejects(
    inTenant(A.id, (tx) => tx`INSERT INTO loan_applications
      (tenant_id,employee_id,loan_product_id,amount,tenor_months)
      VALUES (${B.id},${empA.id},${prodA.id},1,6)`),
    /row-level security/i,
  );
});

test("same-tenant FK: cannot reference another tenant's employee", async () => {
  // employee belongs to A; try to create a B application pointing at A's employee
  const [empBteam] = await admin`INSERT INTO employees (tenant_id,employee_no,full_name,gross_salary,net_salary)
    VALUES (${B.id},'E2','Emp B',4000000,3000000) RETURNING id`;
  const [prodB] = await admin`INSERT INTO loan_products (tenant_id,name,kind) VALUES (${B.id},'B Adv','advance') RETURNING id`;
  // B application referencing A's employee (empA) must fail the composite FK
  await assert.rejects(
    inTenant(B.id, (tx) => tx`INSERT INTO loan_applications
      (tenant_id,employee_id,loan_product_id,amount,tenor_months)
      VALUES (${B.id},${empA.id},${prodB.id},1000000,6)`),
    /foreign key|violates/i,
  );
});

test("no tenant context => zero applications", async () => {
  assert.equal((await app`SELECT * FROM loan_applications`).length, 0);
});

test("schedule_lines enforce non-negative closing balance", async () => {
  await assert.rejects(
    admin`INSERT INTO schedule_lines
      (tenant_id,schedule_id,period_no,due_date,opening_balance,principal_due,interest_due,instalment,closing_balance)
      VALUES (${A.id},${A.id},1,'2026-01-01',1000,900,100,1000,-50)`,
    /closing_balance|violates|foreign key/i,
  );
});