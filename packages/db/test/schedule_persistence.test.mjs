import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { persistSchedule } from "../src/schedules.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
let admin, app, A, B, loanA;

const inTenant = (tid, fn) =>
  app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tid}, true)`;
    return fn(tx);
  });

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 2 });
  for (const t of ['schedule_lines','loan_schedules','loans','loan_applications'])
    await admin.unsafe(`DELETE FROM ${t} WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('sch-a','sch-b'))`);
  await admin`DELETE FROM loan_products WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('sch-a','sch-b'))`;
  await admin`DELETE FROM employees WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('sch-a','sch-b'))`;
  await admin`DELETE FROM tenants WHERE slug IN ('sch-a','sch-b')`;

  [A] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('sch-a','Sch A','active') RETURNING id`;
  [B] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('sch-b','Sch B','active') RETURNING id`;
  const [emp] = await admin`INSERT INTO employees (tenant_id,employee_no,full_name,gross_salary,net_salary)
    VALUES (${A.id},'E1','Emp',5000000,3500000) RETURNING id`;
  const [prod] = await admin`INSERT INTO loan_products (tenant_id,name,kind) VALUES (${A.id},'Adv','term') RETURNING id`;
  const [appn] = await admin`INSERT INTO loan_applications (tenant_id,employee_id,loan_product_id,amount,tenor_months,status)
    VALUES (${A.id},${emp.id},${prod.id},10000000,36,'approved') RETURNING id`;
  [loanA] = await admin`INSERT INTO loans (tenant_id,application_id,principal,annual_rate,rate_mode,start_date,tenor_months)
    VALUES (${A.id},${appn.id},10000000,0.16,'fixed','2020-08-30',36) RETURNING id`;
});
after(async () => { await app.end(); await admin.end(); });

test("persists a full schedule with correct line count", async () => {
  const result = await inTenant(A.id, (tx) => persistSchedule(tx, {
    tenantId: A.id, loanId: loanA.id, principal: 10000000,
    annualRate: 0.16, tenorMonths: 36, startDate: new Date(2020,7,30), decimals: 0,
  }));
  assert.equal(result.version, 1);
  assert.equal(result.lineCount, 36);
});

test("persisted lines readable within tenant, closes at zero", async () => {
  const lines = await inTenant(A.id, (tx) =>
    tx`SELECT period_no, closing_balance FROM schedule_lines
       WHERE schedule_id IN (SELECT id FROM loan_schedules WHERE loan_id=${loanA.id} AND is_active)
       ORDER BY period_no`);
  assert.equal(lines.length, 36);
  assert.equal(Number(lines[lines.length-1].closing_balance), 0);
});

test("another tenant cannot see the persisted schedule", async () => {
  const seenByB = await inTenant(B.id, (tx) =>
    tx`SELECT * FROM schedule_lines WHERE tenant_id = ${A.id}`);
  assert.equal(seenByB.length, 0);
});

test("re-persisting creates version 2 and deactivates version 1", async () => {
  const result = await inTenant(A.id, (tx) => persistSchedule(tx, {
    tenantId: A.id, loanId: loanA.id, principal: 10000000,
    annualRate: 0.16, tenorMonths: 36, startDate: new Date(2020,7,30), decimals: 0,
  }));
  assert.equal(result.version, 2);
  const active = await inTenant(A.id, (tx) =>
    tx`SELECT version FROM loan_schedules WHERE loan_id=${loanA.id} AND is_active`);
  assert.equal(active.length, 1);
  assert.equal(Number(active[0].version), 2);
});