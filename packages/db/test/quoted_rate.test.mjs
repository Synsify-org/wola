// A rate-index change (e.g. a new CBR) must reach applications made AFTER it,
// not ones already in flight, and never a running loan. The rate is quoted at
// submission and frozen into the application; final approval uses that quote.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { decide, resolveRate } from "../src/approvals.ts";
import { setRateIndex } from "../src/rate-indices.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
let admin, app, T;
const ids = {};

const inTenant = (fn) =>
  app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${T}, true)`;
    return fn(tx);
  });

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 2 });

  await admin`DELETE FROM tenants WHERE slug = 'quote-t'`;
  await admin`DELETE FROM users WHERE email LIKE '%@quote.t'`;
  const [t] = await admin`INSERT INTO tenants (slug,name,status)
    VALUES ('quote-t','Quote Test','active') RETURNING id`;
  T = t.id;

  const mk = async (email, role) => {
    const [u] = await admin`INSERT INTO users (email,name,status,password_hash)
      VALUES (${email}, ${email}, 'active', 'x') RETURNING id`;
    await admin`INSERT INTO memberships (tenant_id,user_id,role) VALUES (${T}, ${u.id}, ${role})`;
    return u.id;
  };
  ids.uHead = await mk("head@quote.t", "dept_head");
  ids.uStaff = await mk("staff@quote.t", "employee");
  ids.uStaff2 = await mk("staff2@quote.t", "employee");
  ids.uHr = await mk("hr@quote.t", "hr");

  const [head] = await admin`INSERT INTO employees
    (tenant_id,user_id,employee_no,full_name,gross_salary,net_salary,is_post_probation)
    VALUES (${T},${ids.uHead},'H1','Head',9000000,7000000,true) RETURNING id`;
  ids.eHead = head.id;
  const emp = async (uid, no) => {
    const [e] = await admin`INSERT INTO employees
      (tenant_id,user_id,employee_no,full_name,gross_salary,net_salary,is_post_probation,department_head_id)
      VALUES (${T},${uid},${no},${no},5000000,4000000,true,${ids.eHead}) RETURNING id`;
    return e.id;
  };
  ids.eStaff = await emp(ids.uStaff, "S1");
  ids.eStaff2 = await emp(ids.uStaff2, "S2");
  ids.eHr = await emp(ids.uHr, "R1");

  // CBR starts at 9.5%.
  const [ri] = await admin`INSERT INTO rate_indices (tenant_id,name,current_value,effective_from)
    VALUES (${T},'CBR',9.500,'2026-01-01') RETURNING id`;
  const [p] = await admin`INSERT INTO loan_products (tenant_id,name,kind,rate_index_id,interest_applies)
    VALUES (${T},'Dev Loan','term',${ri.id},true) RETURNING id`;
  ids.product = p.id;
  // Two-stage pipeline keeps the test short: dept_head -> hr (final).
  const [pl] = await admin`INSERT INTO approval_pipelines (tenant_id,loan_product_id,applies_to)
    VALUES (${T},${p.id},'default') RETURNING id`;
  for (const [pos, role] of [[1, "dept_head"], [2, "hr"]]) {
    await admin`INSERT INTO approval_stages (tenant_id,pipeline_id,position,approver_role)
      VALUES (${T},${pl.id},${pos},${role})`;
  }
});

after(async () => {
  await app.end();
  await admin.end();
});

const submit = async (employeeId, snapshot) => {
  await admin`UPDATE loan_applications SET status = 'withdrawn'
    WHERE employee_id = ${employeeId} AND status IN ('submitted','in_review')`;
  const [a] = await admin`INSERT INTO loan_applications
    (tenant_id,employee_id,loan_product_id,amount,tenor_months,status,eligibility_snapshot)
    VALUES (${T},${employeeId},${ids.product},6000000,12,'submitted',${admin.json(snapshot)})
    RETURNING id`;
  return a.id;
};

const approveToLoan = async (applicationId) => {
  const head = { userId: ids.uHead, employeeId: ids.eHead, role: "dept_head" };
  const hr = { userId: ids.uHr, employeeId: ids.eHr, role: "hr" };
  const r1 = await inTenant((tx) =>
    decide(tx, { tenantId: T, applicationId, actor: head, decision: "approved" }));
  assert.equal(r1.ok, true, r1.error);
  const r2 = await inTenant((tx) =>
    decide(tx, { tenantId: T, applicationId, actor: hr, decision: "approved", startDate: new Date("2026-06-01") }));
  assert.equal(r2.ok, true, r2.error);
  const [loan] = await admin`SELECT annual_rate FROM loans WHERE id = ${r2.loanId}`;
  return Number(loan.annual_rate);
};

test("an application keeps the rate it was quoted, even after the CBR rises before approval", async () => {
  const appId = await submit(ids.eStaff, { annualRate: 0.095, rateMode: "index_plus_margin" });

  // CBR jumps to 20% while the application is in review.
  await inTenant((tx) => setRateIndex(tx, { tenantId: T, name: "CBR", value: 20, effectiveFrom: new Date("2026-03-01") }));
  const now = await inTenant((tx) => resolveRate(tx, ids.product));
  assert.equal(now.rate, 0.2, "sanity: the product now charges 20%");

  const loanRate = await approveToLoan(appId);
  assert.equal(loanRate, 0.095, "the loan must carry the quoted 9.5%, not today's 20%");
});

test("an application submitted AFTER the change is quoted the new rate", async () => {
  const quote = await inTenant((tx) => resolveRate(tx, ids.product));
  assert.equal(quote.ok, true);
  const appId = await submit(ids.eStaff2, { annualRate: quote.rate, rateMode: quote.mode });
  const loanRate = await approveToLoan(appId);
  assert.equal(loanRate, 0.2);
});

test("an application from before quoting existed falls back to the current rate", async () => {
  const appId = await submit(ids.eStaff, { product: "Dev Loan" }); // no annualRate in the snapshot
  const loanRate = await approveToLoan(appId);
  assert.equal(loanRate, 0.2);
});

test("a running loan's rate never moves when the CBR changes afterwards", async () => {
  const [loan] = await admin`SELECT l.id, l.annual_rate FROM loans l WHERE l.tenant_id = ${T}
    ORDER BY l.created_at ASC LIMIT 1`;
  const before = Number(loan.annual_rate);
  await inTenant((tx) => setRateIndex(tx, { tenantId: T, name: "CBR", value: 30, effectiveFrom: new Date("2026-04-01") }));
  const [after] = await admin`SELECT annual_rate FROM loans WHERE id = ${loan.id}`;
  assert.equal(Number(after.annual_rate), before);
});
