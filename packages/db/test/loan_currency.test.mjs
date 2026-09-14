import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { createLoanFromApplication } from "../src/loans.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
let admin, app, ugxTenant, kesTenant;

const inTenant = (tid, fn) =>
  app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tid}, true)`;
    return fn(tx);
  });

async function makeApprovedApplication(admin, tenantId, amount) {
  const [emp] = await admin`INSERT INTO employees (tenant_id,employee_no,full_name,gross_salary,net_salary)
    VALUES (${tenantId},'E1','Emp',5000000,3500000) RETURNING id`;
  const [prod] = await admin`INSERT INTO loan_products (tenant_id,name,kind) VALUES (${tenantId},'Adv','term') RETURNING id`;
  const [appn] = await admin`INSERT INTO loan_applications (tenant_id,employee_id,loan_product_id,amount,tenor_months,status)
    VALUES (${tenantId},${emp.id},${prod.id},${amount},12,'approved') RETURNING id`;
  return appn.id;
}

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 2 });
  for (const t of ['schedule_lines','loan_schedules','loans','loan_applications'])
    await admin.unsafe(`DELETE FROM ${t} WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('cur-ugx','cur-kes'))`);
  await admin`DELETE FROM loan_products WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('cur-ugx','cur-kes'))`;
  await admin`DELETE FROM employees WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('cur-ugx','cur-kes'))`;
  await admin`DELETE FROM tenants WHERE slug IN ('cur-ugx','cur-kes')`;

  [ugxTenant] = await admin`INSERT INTO tenants (slug,name,status,currency) VALUES ('cur-ugx','Cur UGX','active','UGX') RETURNING id`;
  [kesTenant] = await admin`INSERT INTO tenants (slug,name,status,currency) VALUES ('cur-kes','Cur KES','active','KES') RETURNING id`;
});
after(async () => { await app.end(); await admin.end(); });

test("a UGX tenant's loan schedule has whole-shilling instalments (0 decimals)", async () => {
  const applicationId = await makeApprovedApplication(admin, ugxTenant.id, 1000000);
  const result = await inTenant(ugxTenant.id, (tx) =>
    createLoanFromApplication(tx, {
      tenantId: ugxTenant.id, applicationId, annualRate: 0.16, startDate: new Date(2026, 0, 1),
    }));
  const lines = await inTenant(ugxTenant.id, (tx) =>
    tx`SELECT instalment FROM schedule_lines WHERE schedule_id IN
       (SELECT id FROM loan_schedules WHERE loan_id = ${result.loanId} AND is_active)`);
  for (const l of lines) {
    assert.equal(Number(l.instalment), Math.round(Number(l.instalment)), `expected a whole number, got ${l.instalment}`);
  }
});

test("a KES tenant's loan schedule has 2-decimal instalments, not rounded to whole shillings", async () => {
  // An amount/rate/tenor combination whose exact instalment is NOT a whole number,
  // so a decimals:0 regression (rounding away the cents) is actually detectable.
  const applicationId = await makeApprovedApplication(admin, kesTenant.id, 1000001);
  const result = await inTenant(kesTenant.id, (tx) =>
    createLoanFromApplication(tx, {
      tenantId: kesTenant.id, applicationId, annualRate: 0.16, startDate: new Date(2026, 0, 1),
    }));
  const lines = await inTenant(kesTenant.id, (tx) =>
    tx`SELECT instalment FROM schedule_lines WHERE schedule_id IN
       (SELECT id FROM loan_schedules WHERE loan_id = ${result.loanId} AND is_active)
       ORDER BY period_no`);
  const hasFraction = lines.some((l) => Number(l.instalment) !== Math.round(Number(l.instalment)));
  assert.ok(hasFraction, "expected at least one instalment with cents, got only whole numbers");
});
