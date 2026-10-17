// packages/db/test/interest_report.test.mjs
// interestReport() feeds the CFO's interest report on /reports.
// Proves: one point per month in the range; expected = interest_due on live loans'
// active schedules (undisbursed loans don't count, a settled loan stops at the day it
// was paid off); collected = the interest part of repayments by value date; the
// product split adds up; the range is ordered and capped; and RLS keeps it per tenant.
// Real DB, file-scoped slugs, cleans up only its own rows.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { persistSchedule } from "../src/schedules.ts";
import { interestReport } from "../src/metrics.ts";
import { effectiveDueDate } from "@wola/engine";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
const SLUGS = ["intr-a", "intr-b"];
let admin, app, T, OTHER;
const loans = {};

const inTenant = (tid, fn) =>
  app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tid}, true)`;
    return fn(tx);
  });

// Month keys relative to now. Plain strings for DATE columns (see collections_trend).
const now = new Date();
const ym = (k) => {
  const d = new Date(now.getFullYear(), now.getMonth() + k, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const day = (k, dd = "01") => `${ym(k)}-${dd}`;

async function makeLoan(name, status, product) {
  const [emp] = await admin`INSERT INTO employees (tenant_id,employee_no,full_name,gross_salary,net_salary)
    VALUES (${T},${"I" + name},${"Emp " + name},5000000,3500000) RETURNING id`;
  let [prod] = await admin`SELECT id FROM loan_products WHERE tenant_id = ${T} AND name = ${product}`;
  if (!prod) [prod] = await admin`INSERT INTO loan_products (tenant_id,name,kind) VALUES (${T},${product},'term') RETURNING id`;
  const [appn] = await admin`INSERT INTO loan_applications (tenant_id,employee_id,loan_product_id,amount,tenor_months,status)
    VALUES (${T},${emp.id},${prod.id},1200000,6,'approved') RETURNING id`;
  const start = new Date(now.getFullYear(), now.getMonth() - 4, 1); // periods 1..6 due from 3 months ago
  const [loan] = await admin`INSERT INTO loans (tenant_id,application_id,principal,annual_rate,rate_mode,start_date,tenor_months,status)
    VALUES (${T},${appn.id},1200000,0.16,'fixed',${day(-4)},6,${status}) RETURNING id`;
  await inTenant(T, (tx) => persistSchedule(tx, {
    tenantId: T, loanId: loan.id, principal: 1200000, annualRate: 0.16, tenorMonths: 6, startDate: start, decimals: 0,
  }));
  loans[name] = loan.id;
  return loan.id;
}

const scheduledInterest = async (loanId) => admin`
  SELECT to_char(sl.due_date, 'YYYY-MM') AS month, to_char(sl.due_date, 'YYYY-MM-DD') AS due, sl.interest_due
  FROM schedule_lines sl JOIN loan_schedules s ON s.id = sl.schedule_id AND s.is_active
  WHERE s.loan_id = ${loanId} ORDER BY sl.period_no`;

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 2 });
  for (const s of SLUGS) await admin`DELETE FROM tenants WHERE slug = ${s}`;
  [{ id: T }] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('intr-a','Interest A','active') RETURNING id`;
  [{ id: OTHER }] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('intr-b','Interest B','active') RETURNING id`;
});
after(async () => {
  for (const s of SLUGS) await admin`DELETE FROM tenants WHERE slug = ${s}`;
  await app.end();
  await admin.end();
});

test("one point per month in the range, flagged current and future", async () => {
  const r = await inTenant(T, (tx) => interestReport(tx, { from: ym(-2), to: ym(2) }));
  assert.deepEqual(r.months.map((m) => m.month), [ym(-2), ym(-1), ym(0), ym(1), ym(2)]);
  assert.deepEqual(r.months.map((m) => m.current), [false, false, true, false, false]);
  assert.deepEqual(r.months.map((m) => m.future), [false, false, false, true, true]);
  assert.ok(r.months.every((m) => m.expected === 0 && m.collected === 0), "an empty book reports zeros");
});

test("expected = scheduled interest on live loans; undisbursed loans don't count", async () => {
  const live = await makeLoan("live", "active", "Car");
  await makeLoan("pending", "pending_disbursement", "Car");

  const byMonth = {};
  for (const l of await scheduledInterest(live)) byMonth[l.month] = (byMonth[l.month] ?? 0) + Number(l.interest_due);

  const r = await inTenant(T, (tx) => interestReport(tx, { from: ym(-4), to: ym(4) }));
  for (const m of r.months) assert.equal(m.expected, byMonth[m.month] ?? 0, `expected for ${m.month}`);
  assert.ok(r.totals.expected > 0, "fixture should put interest inside the range");
  assert.equal(
    Math.round((r.totals.expectedToDate + r.totals.expectedAhead) * 100),
    Math.round(r.totals.expected * 100),
    "finished months + this month and ahead = total",
  );
});

test("collected = the interest part of repayments, in the month they landed", async () => {
  await admin`INSERT INTO repayments (tenant_id,loan_id,source,amount,value_date,allocation)
    VALUES (${T},${loans.live},'payroll',216000,${day(-2, "15")},${admin.json({ interest: 16000, principal: 200000 })}),
           (${T},${loans.live},'manual', 100000,${day(-2, "20")},${admin.json({ interest: 0, principal: 100000 })}),
           (${T},${loans.live},'payroll',214000,${day(0, "02")},${admin.json({ interest: 14000, principal: 200000 })})`;

  const r = await inTenant(T, (tx) => interestReport(tx, { from: ym(-3), to: ym(1) }));
  const at = (k) => r.months.find((m) => m.month === ym(k));
  assert.equal(at(-2).collected, 16000, "only the interest part counts, not principal");
  assert.equal(at(0).collected, 14000);
  assert.equal(at(-1).collected, 0);
  assert.equal(r.totals.collected, 30000);
  assert.equal(r.totals.collectedToDate, 16000, "this month is still in progress, so it is not measured yet");
});

test("a settled loan stops being expected after the day it was paid off", async () => {
  const settled = await makeLoan("settled", "settled", "Advance");
  await admin`INSERT INTO repayments (tenant_id,loan_id,source,amount,value_date,allocation)
    VALUES (${T},${settled},'early',1220000,${day(-2, "20")},${admin.json({ interest: 20000, principal: 1200000 })})`;

  const lines = await scheduledInterest(settled);
  const cutoff = day(-2, "20");
  const expectedBefore = lines.filter((l) => l.due <= cutoff).reduce((s, l) => s + Number(l.interest_due), 0);
  assert.ok(lines.some((l) => l.due > cutoff), "fixture should have lines after the payoff");

  const r = await inTenant(T, (tx) => interestReport(tx, { from: ym(-4), to: ym(4) }));
  const advance = r.byProduct.find((p) => p.product === "Advance");
  assert.equal(advance.expected, Math.round(expectedBefore * 100) / 100, "nothing expected after payoff");
  assert.equal(advance.collected, 20000);
});

test("the product split adds up to the totals", async () => {
  const r = await inTenant(T, (tx) => interestReport(tx, { from: ym(-4), to: ym(4) }));
  const sum = (k) => Math.round(r.byProduct.reduce((s, p) => s + p[k], 0) * 100);
  assert.equal(sum("expected"), Math.round(r.totals.expected * 100));
  assert.equal(sum("collected"), Math.round(r.totals.collected * 100));
  assert.deepEqual(r.byProduct.map((p) => p.product).sort(), ["Advance", "Car"]);
});

test("a reversed range is put in order, and a long one is capped at 36 months", async () => {
  const flipped = await inTenant(T, (tx) => interestReport(tx, { from: ym(2), to: ym(-2) }));
  assert.equal(flipped.from, ym(-2));
  assert.equal(flipped.months.length, 5);
  const long = await inTenant(T, (tx) => interestReport(tx, { from: ym(-60), to: ym(0) }));
  assert.equal(long.months.length, 36);
  await assert.rejects(inTenant(T, (tx) => interestReport(tx, { from: "2026-13", to: ym(0) })), /YYYY-MM/);
});

test("another tenant sees none of it", async () => {
  const r = await inTenant(OTHER, (tx) => interestReport(tx, { from: ym(-4), to: ym(4) }));
  assert.ok(r.months.every((m) => m.expected === 0 && m.collected === 0));
  assert.deepEqual(r.byProduct, []);
});

test("a payment holiday moves an instalment's interest to the month it is now due", async () => {
  const before = await inTenant(T, (tx) => interestReport(tx, { from: ym(-4), to: ym(6) }));
  const held = await makeLoan("held", "active", "Holiday");
  const added = await inTenant(T, (tx) => interestReport(tx, { from: ym(-4), to: ym(6) }));

  // One month off, next month: that instalment and every later one fall a month later.
  const window = { from: `${ym(1)}-01`, to: `${ym(1)}-28` };
  await admin`INSERT INTO loan_suspensions (tenant_id,loan_id,from_date,to_date,reason)
    VALUES (${T},${held},${window.from},${window.to},'Unpaid leave')`;
  const after = await inTenant(T, (tx) => interestReport(tx, { from: ym(-4), to: ym(6) }));

  const lines = await scheduledInterest(held);
  const shifted = {};
  for (const l of lines) {
    const m = effectiveDueDate(l.due, [window]).slice(0, 7);
    shifted[m] = (shifted[m] ?? 0) + Number(l.interest_due);
  }
  const cents = (n) => Math.round(n * 100);
  for (const m of after.months) {
    const base = before.months.find((x) => x.month === m.month).expected;
    assert.equal(cents(m.expected - base), cents(shifted[m.month] ?? 0), `held loan's interest in ${m.month}`);
  }
  assert.notDeepEqual(after.months.map((m) => m.expected), added.months.map((m) => m.expected), "the holiday moved something");
});
