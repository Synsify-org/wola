// packages/db/test/collections_trend.test.mjs
// collectionsTrend() feeds the dashboards' "Collected vs Expected" chart.
// Proves: one zero-filled point per month ending at the current month;
// expected = instalments due that month on active schedules of live loans
// only; collected = repayments by value date; and RLS keeps it per tenant.
// Real DB, file-scoped slugs, cleans up only its own rows.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { persistSchedule } from "../src/schedules.ts";
import { collectionsTrend } from "../src/metrics.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
const SLUGS = ["coltr-a", "coltr-b"];
let admin, app, T, OTHER;

const inTenant = (tid, fn) =>
  app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tid}, true)`;
    return fn(tx);
  });

// Plain YYYY-MM-DD strings for DATE columns: a local-midnight Date for the 1st
// serialises as the previous day in UTC on any UTC+ machine.
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
const now = new Date();
const monthsAgo = (k) => new Date(now.getFullYear(), now.getMonth() - k, 1);

async function makeLoan(status) {
  const [emp] = await admin`INSERT INTO employees (tenant_id,employee_no,full_name,gross_salary,net_salary)
    VALUES (${T},${"C" + status},${"Emp " + status},5000000,3500000) RETURNING id`;
  const [prod] = await admin`INSERT INTO loan_products (tenant_id,name,kind)
    VALUES (${T},${"Prod " + status},'term') RETURNING id`;
  const [appn] = await admin`INSERT INTO loan_applications (tenant_id,employee_id,loan_product_id,amount,tenor_months,status)
    VALUES (${T},${emp.id},${prod.id},1200000,6,'approved') RETURNING id`;
  const start = monthsAgo(4); // periods 1..6 fall due from 3 months ago onward
  const [loan] = await admin`INSERT INTO loans (tenant_id,application_id,principal,annual_rate,rate_mode,start_date,tenor_months,status)
    VALUES (${T},${appn.id},1200000,0.16,'fixed',${start},6,${status}) RETURNING id`;
  await inTenant(T, (tx) => persistSchedule(tx, {
    tenantId: T, loanId: loan.id, principal: 1200000, annualRate: 0.16,
    tenorMonths: 6, startDate: start, decimals: 0,
  }));
  return loan.id;
}

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 2 });
  for (const s of SLUGS) await admin`DELETE FROM tenants WHERE slug = ${s}`;
  [{ id: T }] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('coltr-a','Coll A','active') RETURNING id`;
  [{ id: OTHER }] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('coltr-b','Coll B','active') RETURNING id`;
});
after(async () => {
  for (const s of SLUGS) await admin`DELETE FROM tenants WHERE slug = ${s}`;
  await app.end();
  await admin.end();
});

test("one zero-filled point per month, oldest first, ending at the current month", async () => {
  const pts = await inTenant(T, (tx) => collectionsTrend(tx, 6));
  assert.equal(pts.length, 6);
  assert.deepEqual(pts.map((p) => p.month), [5, 4, 3, 2, 1, 0].map((k) => monthKey(monthsAgo(k))));
  assert.deepEqual(pts.map((p) => p.current), [false, false, false, false, false, true]);
  assert.ok(pts.every((p) => p.expected === 0 && p.collected === 0), "empty tenant plots zeros, not gaps");
});

test("expected = instalments due each month on live loans; undisbursed loans don't count", async () => {
  const live = await makeLoan("active");
  await makeLoan("pending_disbursement"); // has a schedule, but nothing is owed yet

  const lines = await admin`
    SELECT sl.due_date, sl.instalment FROM schedule_lines sl
    JOIN loan_schedules s ON s.id = sl.schedule_id AND s.is_active
    WHERE s.loan_id = ${live}`;
  const byMonth = {};
  for (const l of lines) {
    const k = monthKey(new Date(l.due_date));
    byMonth[k] = (byMonth[k] ?? 0) + Number(l.instalment);
  }

  const pts = await inTenant(T, (tx) => collectionsTrend(tx, 6));
  for (const p of pts) assert.equal(p.expected, byMonth[p.month] ?? 0, `expected for ${p.month}`);
  assert.ok(pts.some((p) => p.expected > 0), "fixture should put instalments inside the window");
});

test("collected = repayments by value date, in the month they landed", async () => {
  const [{ id: loanId }] = await admin`SELECT l.id FROM loans l WHERE l.tenant_id = ${T} AND l.status = 'active'`;
  await admin`INSERT INTO repayments (tenant_id,loan_id,source,amount,value_date,allocation)
    VALUES (${T},${loanId},'payroll',150000,${monthKey(monthsAgo(2))},${admin.json({ interest: 0, principal: 150000 })}),
           (${T},${loanId},'manual', 50000,${monthKey(monthsAgo(2))},${admin.json({ interest: 0, principal: 50000 })}),
           (${T},${loanId},'payroll',210000,${monthKey(monthsAgo(0))},${admin.json({ interest: 0, principal: 210000 })})`;

  const pts = await inTenant(T, (tx) => collectionsTrend(tx, 6));
  const at = (k) => pts.find((p) => p.month === monthKey(monthsAgo(k)));
  assert.equal(at(2).collected, 200000, "payroll + manual both count as cash collected");
  assert.equal(at(0).collected, 210000);
  assert.equal(at(1).collected, 0);
});

test("another tenant sees none of it", async () => {
  const pts = await inTenant(OTHER, (tx) => collectionsTrend(tx, 6));
  assert.ok(pts.every((p) => p.expected === 0 && p.collected === 0));
});

test("the window is clamped to 1..24 months", async () => {
  assert.equal((await inTenant(T, (tx) => collectionsTrend(tx, 0))).length, 1);
  assert.equal((await inTenant(T, (tx) => collectionsTrend(tx, 99))).length, 24);
});
