// Proves the approval pipeline routes, authorizes, and terminates correctly
// against the real database — the audit-critical controls.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { routeApplication, decide } from "../src/approvals.ts";

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

  // Fresh tenant AND its users — users are global (no tenant_id), so the
  // tenant cascade does NOT remove them. Without this the fixture is not
  // idempotent and re-runs collide on the unique email.
  await admin`DELETE FROM tenants WHERE slug = 'appr-t'`;
  await admin`DELETE FROM users WHERE email LIKE '%@appr.t'`;
  const [t] = await admin`INSERT INTO tenants (slug,name,status)
    VALUES ('appr-t','Approval Test','active') RETURNING id`;
  T = t.id;

  // Users + memberships: staff (applicant), head, hr, cfo, ceo
  const mk = async (email, role) => {
    const [u] = await admin`INSERT INTO users (email,name,status,password_hash)
      VALUES (${email}, ${email}, 'active', 'x') RETURNING id`;
    await admin`INSERT INTO memberships (tenant_id,user_id,role)
      VALUES (${T}, ${u.id}, ${role})`;
    return u.id;
  };
  ids.uStaff = await mk("staff@appr.t", "employee");
  ids.uHead = await mk("head@appr.t", "dept_head");
  ids.uHr = await mk("hr@appr.t", "hr");
  ids.uCfo = await mk("cfo@appr.t", "cfo");
  ids.uCeo = await mk("ceo@appr.t", "ceo");

  // Employees: head first (others point at them)
  const [head] = await admin`INSERT INTO employees
    (tenant_id,user_id,employee_no,full_name,gross_salary,net_salary,is_post_probation)
    VALUES (${T},${ids.uHead},'H1','Head',9000000,7000000,true) RETURNING id`;
  ids.eHead = head.id;

  const emp = async (uid, no, name) => {
    const [e] = await admin`INSERT INTO employees
      (tenant_id,user_id,employee_no,full_name,gross_salary,net_salary,
       is_post_probation,department_head_id)
      VALUES (${T},${uid},${no},${name},5000000,4000000,true,${ids.eHead}) RETURNING id`;
    return e.id;
  };
  ids.eStaff = await emp(ids.uStaff, "S1", "Staff");
  ids.eHr = await emp(ids.uHr, "R1", "HR");
  ids.eCfo = await emp(ids.uCfo, "C1", "CFO");
  ids.eCeo = await emp(ids.uCeo, "E1", "CEO");

  // Product + default pipeline: dept_head -> hr -> cfo -> ceo
  const [p] = await admin`INSERT INTO loan_products (tenant_id,name,kind)
    VALUES (${T},'Dev Loan','term') RETURNING id`;
  ids.product = p.id;
  const [pl] = await admin`INSERT INTO approval_pipelines (tenant_id,loan_product_id,applies_to)
    VALUES (${T},${p.id},'default') RETURNING id`;
  for (const [pos, role] of [[1,'dept_head'],[2,'hr'],[3,'cfo'],[4,'ceo']]) {
    await admin`INSERT INTO approval_stages (tenant_id,pipeline_id,position,approver_role)
      VALUES (${T},${pl.id},${pos},${role})`;
  }
});

after(async () => {
  await app.end();
  await admin.end();
});

const newApplication = async (employeeId) => {
  const [a] = await admin`INSERT INTO loan_applications
    (tenant_id,employee_id,loan_product_id,amount,tenor_months,status)
    VALUES (${T},${employeeId},${ids.product},10000000,24,'submitted') RETURNING id`;
  return a.id;
};

const actor = (userId, employeeId, role) => ({ userId, employeeId, role });

test("a staff application starts at the dept_head stage", async () => {
  const appId = await newApplication(ids.eStaff);
  const r = await inTenant((tx) => routeApplication(tx, appId));
  assert.equal(r.routing.state, "pending");
  assert.equal(r.routing.currentStage.approverRole, "dept_head");
});

test("only the applicant's OWN dept head may approve that stage", async () => {
  const appId = await newApplication(ids.eStaff);
  // HR (wrong role for this stage) is refused
  const bad = await inTenant((tx) => decide(tx, {
    tenantId: T, applicationId: appId,
    actor: actor(ids.uHr, ids.eHr, "hr"), decision: "approved",
  }));
  assert.equal(bad.ok, false);
  // the real head succeeds
  const good = await inTenant((tx) => decide(tx, {
    tenantId: T, applicationId: appId,
    actor: actor(ids.uHead, ids.eHead, "dept_head"), decision: "approved",
  }));
  assert.equal(good.ok, true);
  assert.equal(good.routing.currentStage.approverRole, "hr");
});

test("full chain: dept_head -> hr -> cfo -> ceo approves the application", async () => {
  const appId = await newApplication(ids.eStaff);
  const step = (uid, eid, role) => inTenant((tx) => decide(tx, {
    tenantId: T, applicationId: appId,
    actor: actor(uid, eid, role), decision: "approved",
  }));
  await step(ids.uHead, ids.eHead, "dept_head");
  await step(ids.uHr, ids.eHr, "hr");
  await step(ids.uCfo, ids.eCfo, "cfo");
  const last = await step(ids.uCeo, ids.eCeo, "ceo");
  assert.equal(last.ok, true);
  assert.equal(last.routing.state, "approved");

  const [row] = await admin`SELECT status FROM loan_applications WHERE id=${appId}`;
  assert.equal(row.status, "approved");
});

test("NO SELF-APPROVAL: the CFO's own application skips the CFO stage", async () => {
  const appId = await newApplication(ids.eCfo);
  const r = await inTenant((tx) => routeApplication(tx, appId));
  // dept_head -> hr -> ceo  (cfo stage removed)
  assert.deepEqual(
    r.routing.stages.map((s) => s.approverRole),
    ["dept_head", "hr", "ceo"],
  );

  const step = (uid, eid, role) => inTenant((tx) => decide(tx, {
    tenantId: T, applicationId: appId,
    actor: actor(uid, eid, role), decision: "approved",
  }));
  await step(ids.uHead, ids.eHead, "dept_head");
  await step(ids.uHr, ids.eHr, "hr");
  const last = await step(ids.uCeo, ids.eCeo, "ceo");   // CEO, not CFO
  assert.equal(last.routing.state, "approved");
});

test("the CFO cannot approve their own application even by trying", async () => {
  const appId = await newApplication(ids.eCfo);
  await inTenant((tx) => decide(tx, {
    tenantId: T, applicationId: appId,
    actor: actor(ids.uHead, ids.eHead, "dept_head"), decision: "approved",
  }));
  // now at 'hr'. The CFO attempts to act — refused.
  const attempt = await inTenant((tx) => decide(tx, {
    tenantId: T, applicationId: appId,
    actor: actor(ids.uCfo, ids.eCfo, "cfo"), decision: "approved",
  }));
  assert.equal(attempt.ok, false);
});

test("a rejection terminates the application and requires a reason", async () => {
  const appId = await newApplication(ids.eStaff);
  const noReason = await inTenant((tx) => decide(tx, {
    tenantId: T, applicationId: appId,
    actor: actor(ids.uHead, ids.eHead, "dept_head"),
    decision: "rejected", comment: "",
  }));
  assert.equal(noReason.ok, false);

  const rejected = await inTenant((tx) => decide(tx, {
    tenantId: T, applicationId: appId,
    actor: actor(ids.uHead, ids.eHead, "dept_head"),
    decision: "rejected", comment: "Existing exposure too high.",
  }));
  assert.equal(rejected.ok, true);
  assert.equal(rejected.routing.state, "rejected");

  const [row] = await admin`SELECT status FROM loan_applications WHERE id=${appId}`;
  assert.equal(row.status, "rejected");

  // no further decisions accepted
  const after = await inTenant((tx) => decide(tx, {
    tenantId: T, applicationId: appId,
    actor: actor(ids.uHr, ids.eHr, "hr"), decision: "approved",
  }));
  assert.equal(after.ok, false);
});