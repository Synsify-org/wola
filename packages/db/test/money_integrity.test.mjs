// packages/db/test/money_integrity.test.mjs
// Regression tests for four money-handling bugs, each of which let the
// ledger, the schedule, or the application state silently disagree:
//
//   1. decide() recorded a FINAL approval, then refused on a missing rate
//      index WITHOUT throwing — the transaction committed, leaving an
//      application whose routing said "approved" but with no loan and a
//      status stuck at in_review, un-actionable by anyone.
//   2. A lump-sum repayment's re-amortization double-counted the period's
//      scheduled principal (so the schedule under-stated the balance vs the
//      ledger) and regenerated from the ORIGINAL terms (so a second lump sum
//      erased the first).
//   3. Every payment took the current line's FULL interest, so paying one
//      instalment in two halves charged its interest twice and the loan never
//      settled on schedule.
//   4. disburseLoan / recordRepayment read loan status without a row lock, so
//      two concurrent requests could both pass the guard — two pay-outs for
//      one loan, or principal allocated beyond what was owed.
//
// Real DB, file-scoped tenant slug ('money-t'), cleans up only its own rows.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { persistSchedule } from "../src/schedules.ts";
import { recordRepayment, loanOutstanding, disburseLoan } from "../src/loans.ts";
import { decide } from "../src/approvals.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
const SLUG = "money-t";
let admin, app, T;
let loanSeq = 0;

const inTenant = (fn) =>
  app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${T}, true)`;
    return fn(tx);
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A fresh loan (own employee/product/application) with a persisted
 *  schedule, so every test starts from an untouched ledger. */
async function makeLoan({ principal = 1_200_000, rate = 0.16, tenor = 12, status = "active" } = {}) {
  const n = ++loanSeq;
  const [emp] = await admin`INSERT INTO employees (tenant_id,employee_no,full_name,gross_salary,net_salary)
    VALUES (${T},${"M" + n},${"Emp " + n},5000000,3500000) RETURNING id`;
  const [prod] = await admin`INSERT INTO loan_products (tenant_id,name,kind)
    VALUES (${T},${"Prod " + n},'term') RETURNING id`;
  const [appn] = await admin`INSERT INTO loan_applications
    (tenant_id,employee_id,loan_product_id,amount,tenor_months,status)
    VALUES (${T},${emp.id},${prod.id},${principal},${tenor},'approved') RETURNING id`;
  const [loan] = await admin`INSERT INTO loans
    (tenant_id,application_id,principal,annual_rate,rate_mode,start_date,tenor_months,status)
    VALUES (${T},${appn.id},${principal},${rate},'fixed','2024-01-01',${tenor},${status}) RETURNING id`;
  await inTenant((tx) => persistSchedule(tx, {
    tenantId: T, loanId: loan.id, principal, annualRate: rate,
    tenorMonths: tenor, startDate: new Date(2024, 0, 1), decimals: 0,
  }));
  return { loanId: loan.id, applicationId: appn.id, principal };
}

const activeLines = (loanId) => inTenant((tx) => tx`
  SELECT sl.period_no, sl.opening_balance, sl.principal_due, sl.interest_due,
         sl.instalment, sl.closing_balance
  FROM schedule_lines sl JOIN loan_schedules s ON s.id = sl.schedule_id
  WHERE s.loan_id = ${loanId} AND s.is_active ORDER BY sl.period_no`);

const pay = (loanId, amount) => inTenant((tx) =>
  recordRepayment(tx, { tenantId: T, loanId, amount, source: "manual" }));

const allocations = (loanId) => inTenant((tx) => tx`
  SELECT COALESCE(sum((allocation->>'interest')::numeric),0)::float8 AS interest,
         COALESCE(sum((allocation->>'principal')::numeric),0)::float8 AS principal
  FROM repayments WHERE loan_id = ${loanId}`).then((r) => r[0]);

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 4 }); // >1 so concurrency tests get real parallel tx

  await admin`DELETE FROM tenants WHERE slug = ${SLUG}`;
  await admin`DELETE FROM users WHERE email LIKE '%@money.t'`;
  const [t] = await admin`INSERT INTO tenants (slug,name,status)
    VALUES (${SLUG},'Money Integrity','active') RETURNING id`;
  T = t.id;
});

after(async () => {
  await admin`DELETE FROM tenants WHERE slug = ${SLUG}`;
  await admin`DELETE FROM users WHERE email LIKE '%@money.t'`;
  await app.end();
  await admin.end();
});

// ---- Bug 1: final approval must be all-or-nothing -------------------------

test("bug 1: final approval refused for a missing rate index leaves NO trace", async () => {
  const mkUser = async (email, role) => {
    const [u] = await admin`INSERT INTO users (email,name,status,password_hash)
      VALUES (${email},${email},'active','x') RETURNING id`;
    await admin`INSERT INTO memberships (tenant_id,user_id,role) VALUES (${T},${u.id},${role})`;
    return u.id;
  };
  const uStaff = await mkUser("staff@money.t", "employee");
  const uCeo = await mkUser("ceo@money.t", "ceo");
  const [eStaff] = await admin`INSERT INTO employees (tenant_id,user_id,employee_no,full_name,gross_salary,net_salary)
    VALUES (${T},${uStaff},'AS1','Staff',5000000,4000000) RETURNING id`;
  const [eCeo] = await admin`INSERT INTO employees (tenant_id,user_id,employee_no,full_name,gross_salary,net_salary)
    VALUES (${T},${uCeo},'AC1','CEO',9000000,7000000) RETURNING id`;

  // Interest-bearing product with NO rate index — resolveRate must refuse.
  const [prod] = await admin`INSERT INTO loan_products (tenant_id,name,kind,interest_applies)
    VALUES (${T},'No-rate product','term',true) RETURNING id`;
  const [pl] = await admin`INSERT INTO approval_pipelines (tenant_id,loan_product_id,applies_to)
    VALUES (${T},${prod.id},'default') RETURNING id`;
  await admin`INSERT INTO approval_stages (tenant_id,pipeline_id,position,approver_role)
    VALUES (${T},${pl.id},1,'ceo')`;
  const [appn] = await admin`INSERT INTO loan_applications
    (tenant_id,employee_id,loan_product_id,amount,tenor_months,status)
    VALUES (${T},${eStaff.id},${prod.id},1000000,6,'submitted') RETURNING id`;

  const actor = { userId: uCeo, employeeId: eCeo.id, role: "ceo" };
  const attempt = () => inTenant((tx) => decide(tx, {
    tenantId: T, applicationId: appn.id, actor, decision: "approved",
    comment: null, startDate: new Date(2026, 9, 1),
  }));

  const res = await attempt();
  assert.equal(res.ok, false);
  assert.match(res.error, /no rate index/i);

  const [{ n: approvals }] = await admin`SELECT count(*)::int AS n FROM approvals WHERE application_id = ${appn.id}`;
  const [{ status }] = await admin`SELECT status FROM loan_applications WHERE id = ${appn.id}`;
  const [{ n: loans }] = await admin`SELECT count(*)::int AS n FROM loans WHERE application_id = ${appn.id}`;
  assert.equal(approvals, 0, "a refused final approval must not leave an approval row behind");
  assert.equal(status, "submitted", "status must be untouched");
  assert.equal(loans, 0);

  // Not stuck: once finance configures a rate, the SAME approver can approve.
  const [ri] = await admin`INSERT INTO rate_indices (tenant_id,name,current_value)
    VALUES (${T},'CBR',9.5) RETURNING id`;
  await admin`UPDATE loan_products SET rate_index_id = ${ri.id} WHERE id = ${prod.id}`;
  const retry = await attempt();
  assert.equal(retry.ok, true, retry.ok ? "" : retry.error);
  assert.ok(retry.loanId);
  const [{ status: after }] = await admin`SELECT status FROM loan_applications WHERE id = ${appn.id}`;
  assert.equal(after, "approved");
});

// ---- Bug 3: partial payments must not double-charge interest ---------------

test("bug 3: one instalment paid in two halves charges its interest ONCE", async () => {
  const { loanId, principal } = await makeLoan();
  const [l1] = await activeLines(loanId);
  const inst = Number(l1.instalment);
  const half = Math.floor(inst / 2);

  await pay(loanId, half);
  await pay(loanId, inst - half);

  const alloc = await allocations(loanId);
  assert.equal(alloc.interest, Number(l1.interest_due), "interest for period 1 charged exactly once");
  assert.equal(alloc.principal, Number(l1.principal_due));
  const o = await inTenant((tx) => loanOutstanding(tx, T, loanId));
  assert.equal(o.outstanding, principal - Number(l1.principal_due));
});

test("bug 3: paying EVERY instalment in halves settles the loan exactly at the end", async () => {
  const { loanId } = await makeLoan({ tenor: 6 });
  const lines = await activeLines(loanId);
  let last;
  for (const l of lines) {
    const inst = Number(l.instalment);
    const half = Math.floor(inst / 2);
    await pay(loanId, half);
    last = await pay(loanId, inst - half);
  }
  assert.equal(last.settled, true, "the final half-instalment must settle the loan");
  const alloc = await allocations(loanId);
  const scheduledInterest = lines.reduce((s, l) => s + Number(l.interest_due), 0);
  assert.equal(alloc.interest, scheduledInterest, "total interest charged == total scheduled interest");
});

test("on-schedule full instalments still settle exactly (no regression)", async () => {
  const { loanId } = await makeLoan({ tenor: 6 });
  const lines = await activeLines(loanId);
  let last;
  for (const l of lines) last = await pay(loanId, Number(l.instalment));
  assert.equal(last.settled, true);
  assert.equal(last.reamortized, false);
});

// ---- Bug 2: lump sums must keep the schedule in step with the ledger -------

test("bug 2: after a lump sum the schedule's balance matches the ledger", async () => {
  const { loanId } = await makeLoan();
  const [l1] = await activeLines(loanId);
  const res = await pay(loanId, Number(l1.instalment) * 3);
  assert.equal(res.reamortized, true);

  const lines = await activeLines(loanId);
  const o = await inTenant((tx) => loanOutstanding(tx, T, loanId));
  assert.equal(Number(lines[0].closing_balance), o.outstanding,
    "period-1 closing balance on the new schedule must equal the ledger outstanding");
  const futurePrincipal = lines.slice(1).reduce((s, l) => s + Number(l.principal_due), 0);
  assert.equal(futurePrincipal, o.outstanding,
    "remaining scheduled principal must repay exactly what the ledger says is owed");
});

test("bug 2: following the re-amortized schedule settles the loan on its last line", async () => {
  const { loanId } = await makeLoan();
  const [l1] = await activeLines(loanId);
  await pay(loanId, Number(l1.instalment) * 3);

  const remaining = (await activeLines(loanId)).slice(1);
  let last;
  for (const l of remaining) {
    assert.notEqual(last?.settled, true, "loan settled before the schedule ended");
    last = await pay(loanId, Number(l.instalment));
  }
  assert.equal(last.settled, true, "the schedule's final instalment must settle the loan");
});

test("bug 2: a second lump sum builds on the first instead of erasing it", async () => {
  const { loanId } = await makeLoan();
  const [l1] = await activeLines(loanId);
  const inst = Number(l1.instalment);

  await pay(loanId, inst * 3);
  const afterFirst = await activeLines(loanId);
  const res = await pay(loanId, Number(afterFirst[1].instalment) * 3);
  assert.equal(res.reamortized, true);

  const lines = await activeLines(loanId);
  const o = await inTenant((tx) => loanOutstanding(tx, T, loanId));
  assert.equal(Number(lines[1].closing_balance), o.outstanding);
  assert.ok(lines.length < afterFirst.length, "second lump sum shortens the schedule further");
  const [{ n }] = await admin`SELECT count(*)::int AS n FROM loan_schedules WHERE loan_id = ${loanId}`;
  assert.equal(n, 3, "original + one version per lump sum");
});

test("a payment larger than the full payoff is refused, not silently swallowed", async () => {
  const { loanId, principal } = await makeLoan();
  await assert.rejects(pay(loanId, principal * 2), /exceeds/i);
  const [{ n }] = await admin`SELECT count(*)::int AS n FROM repayments WHERE loan_id = ${loanId}`;
  assert.equal(n, 0);
});

// ---- Bug 4: concurrency ----------------------------------------------------

test("bug 4: two concurrent disbursements of one loan — exactly one pays out", async () => {
  const { loanId } = await makeLoan({ status: "pending_disbursement" });
  const args = { tenantId: T, loanId, method: "to_employee", reference: null };

  // Deterministic interleaving: A disburses and HOLDS its transaction open;
  // B starts while A is uncommitted. Without a row lock B reads the stale
  // 'pending_disbursement' and inserts a second disbursement.
  let releaseA;
  const gate = new Promise((r) => { releaseA = r; });
  const a = inTenant(async (tx) => { const r = await disburseLoan(tx, args); await gate; return r; });
  await sleep(150);
  const b = inTenant((tx) => disburseLoan(tx, args));
  await sleep(300);
  releaseA();

  const results = await Promise.allSettled([a, b]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "exactly one disbursement succeeds");
  assert.match(results[1].reason?.message ?? "", /only a pending loan/i);
  const [{ n }] = await admin`SELECT count(*)::int AS n FROM disbursements WHERE loan_id = ${loanId}`;
  assert.equal(n, 1, "exactly one money-out row");
});

test("bug 4: two concurrent payoffs cannot allocate more principal than owed", async () => {
  const { loanId, principal } = await makeLoan({ tenor: 3 });
  const [l1] = await activeLines(loanId);
  const payoff = principal + Number(l1.interest_due);

  let releaseA;
  const gate = new Promise((r) => { releaseA = r; });
  const a = inTenant(async (tx) => {
    const r = await recordRepayment(tx, { tenantId: T, loanId, amount: payoff, source: "manual" });
    await gate; return r;
  });
  await sleep(150);
  const b = inTenant((tx) => recordRepayment(tx, { tenantId: T, loanId, amount: payoff, source: "manual" }));
  await sleep(300);
  releaseA();

  const results = await Promise.allSettled([a, b]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const alloc = await allocations(loanId);
  assert.equal(alloc.principal, principal, "principal allocated never exceeds the principal lent");
});

test("bug 4: the database refuses a second loan for one application", async () => {
  const { applicationId, principal } = await makeLoan();
  await assert.rejects(
    admin`INSERT INTO loans (tenant_id,application_id,principal,annual_rate,rate_mode,start_date,tenor_months,status)
      VALUES (${T},${applicationId},${principal},0.16,'fixed','2024-01-01',12,'pending_disbursement')`,
    (e) => e.code === "23505",
  );
});
