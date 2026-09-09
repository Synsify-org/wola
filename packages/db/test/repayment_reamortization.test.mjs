// packages/db/test/repayment_reamortization.test.mjs
// Regression test for the annual_rate unit bug: recordRepayment()'s lump-sum
// re-amortization branch used to divide the stored rate by 100, treating a
// fraction (0.16 = 16%) as if it were already a percent (16) — silently
// charging ~100x too little interest on any re-amortized schedule. This test
// pins the FIX: the re-amortized schedule's interest must reflect the real
// 16% annual rate, not a rate 100x smaller.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { persistSchedule } from "../src/schedules.ts";
import { recordRepayment, loanOutstanding } from "../src/loans.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
let admin, app, T, loan;

const PRINCIPAL = 10_000_000;
const ANNUAL_RATE = 0.16; // stored as a FRACTION — see resolveRate() in approvals.ts
const TENOR = 12;

const inTenant = (tid, fn) =>
  app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tid}, true)`;
    return fn(tx);
  });

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 2 });

  for (const t of ["repayments", "schedule_lines", "loan_schedules", "loans", "loan_applications"])
    await admin.unsafe(`DELETE FROM ${t} WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = 'reamort-a')`);
  await admin`DELETE FROM loan_products WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = 'reamort-a')`;
  await admin`DELETE FROM employees WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = 'reamort-a')`;
  await admin`DELETE FROM tenants WHERE slug = 'reamort-a'`;

  const [tenant] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('reamort-a','Reamort A','active') RETURNING id`;
  T = tenant.id;

  const [emp] = await admin`INSERT INTO employees (tenant_id,employee_no,full_name,gross_salary,net_salary)
    VALUES (${T},'E1','Emp',5000000,3500000) RETURNING id`;
  const [prod] = await admin`INSERT INTO loan_products (tenant_id,name,kind) VALUES (${T},'Dev','term') RETURNING id`;
  const [appn] = await admin`INSERT INTO loan_applications (tenant_id,employee_id,loan_product_id,amount,tenor_months,status)
    VALUES (${T},${emp.id},${prod.id},${PRINCIPAL},${TENOR},'approved') RETURNING id`;
  [loan] = await admin`INSERT INTO loans (tenant_id,application_id,principal,annual_rate,rate_mode,start_date,tenor_months,status)
    VALUES (${T},${appn.id},${PRINCIPAL},${ANNUAL_RATE},'fixed','2024-01-01',${TENOR},'active') RETURNING id`;

  await inTenant(T, (tx) => persistSchedule(tx, {
    tenantId: T, loanId: loan.id, principal: PRINCIPAL,
    annualRate: ANNUAL_RATE, tenorMonths: TENOR, startDate: new Date(2024, 0, 1), decimals: 0,
  }));
});
after(async () => { await app.end(); await admin.end(); });

test("a lump-sum repayment triggers re-amortization", async () => {
  const [firstLine] = await inTenant(T, (tx) => tx`
    SELECT sl.instalment FROM schedule_lines sl
    JOIN loan_schedules s ON s.id = sl.schedule_id
    WHERE s.loan_id = ${loan.id} AND s.is_active
    ORDER BY sl.period_no LIMIT 1`);
  const instalment = Number(firstLine.instalment);

  // Clearly more than one instalment (recordRepayment's isLumpSum threshold
  // is 1.5x) so the first payment both covers period 1 AND overpays into
  // an early-settlement amount.
  const lumpSum = instalment * 3;

  const result = await inTenant(T, (tx) =>
    recordRepayment(tx, { tenantId: T, loanId: loan.id, amount: lumpSum, source: "manual" }));

  assert.equal(result.reamortized, true, "a payment 3x the instalment must trigger re-amortization");
  assert.equal(result.settled, false);
});

test("the re-amortized schedule uses the REAL annual rate, not a rate divided by 100", async () => {
  const lines = await inTenant(T, (tx) => tx`
    SELECT sl.period_no, sl.opening_balance, sl.interest_due
    FROM schedule_lines sl
    JOIN loan_schedules s ON s.id = sl.schedule_id
    WHERE s.loan_id = ${loan.id} AND s.is_active
    ORDER BY sl.period_no`);

  // version must have incremented — a new schedule was actually persisted,
  // not silently skipped.
  const [{ version }] = await inTenant(T, (tx) =>
    tx`SELECT version FROM loan_schedules WHERE loan_id = ${loan.id} AND is_active`);
  assert.equal(Number(version), 2);

  const first = lines[0];
  const opening = Number(first.opening_balance);
  const actualInterest = Number(first.interest_due);

  // Independently computed expected interest at the REAL 16% annual rate.
  // Whole-shilling rounding, so allow a small tolerance either side.
  const expectedInterest = Math.round(opening * (ANNUAL_RATE / 12));
  assert.ok(
    Math.abs(actualInterest - expectedInterest) <= 2,
    `interest_due (${actualInterest}) should be ~${expectedInterest} (opening ${opening} at 16% p.a.) — ` +
    `if this is ~100x smaller, the annual_rate/100 regression is back`,
  );

  // The regression this test guards against: dividing 0.16 by 100 gives an
  // effective annual rate of 0.16%, i.e. interest ~100x smaller than correct.
  // Assert we are nowhere near that magnitude.
  const buggyInterest = Math.round(opening * ((ANNUAL_RATE / 100) / 12));
  assert.ok(
    actualInterest > buggyInterest * 10,
    "interest_due looks like it was computed with annual_rate wrongly divided by 100",
  );
});

test("true outstanding reflects the lump-sum principal reduction", async () => {
  const outstanding = await inTenant(T, (tx) => loanOutstanding(tx, T, loan.id));
  assert.ok(outstanding.principalRepaid > 0);
  assert.equal(outstanding.outstanding, outstanding.principal - outstanding.principalRepaid);
  assert.ok(outstanding.outstanding < PRINCIPAL);
});

test("another tenant cannot see this loan's repayments", async () => {
  const [other] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('reamort-b','Reamort B','active') RETURNING id`;
  const seenByOther = await inTenant(other.id, (tx) =>
    tx`SELECT * FROM repayments WHERE loan_id = ${loan.id}`);
  assert.equal(seenByOther.length, 0);
  await admin`DELETE FROM tenants WHERE slug = 'reamort-b'`;
});
