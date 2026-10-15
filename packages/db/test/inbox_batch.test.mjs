// inboxFor was rewritten from "three queries per open application" to "three queries in total".
// This proves the answer did not change (compared with the old method, application by
// application, for every kind of approver) and that the cost no longer grows with the number
// of open applications.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { decide, inboxFor, openApplicationsByStage, routeApplication } from "../src/approvals.ts";
import { canAct } from "@wola/engine";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
let admin, app, T, queries = 0;
const ids = {};

const inTenant = (fn) => app.begin(async (tx) => { await tx`SELECT set_config('app.tenant_id', ${T}, true)`; return fn(tx); });

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 2, debug: () => { queries++; } });
  await admin`DELETE FROM tenants WHERE slug = 'inbox-t'`;
  await admin`DELETE FROM users WHERE email LIKE '%@inbox.t'`;
  [{ id: T }] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('inbox-t','Inbox','active') RETURNING id`;
  const user = async (name, role) => {
    const [u] = await admin`INSERT INTO users (email,name,status,password_hash) VALUES (${name + "@inbox.t"},${name},'active','x') RETURNING id`;
    await admin`INSERT INTO memberships (tenant_id,user_id,role) VALUES (${T},${u.id},${role})`;
    return u.id;
  };
  const uHead = await user("head", "dept_head"), uHr = await user("hr", "hr"), uCfo = await user("cfo", "cfo"), uCeo = await user("ceo", "ceo");
  const [head] = await admin`INSERT INTO employees (tenant_id,user_id,employee_no,full_name,gross_salary,net_salary,is_post_probation) VALUES (${T},${uHead},'H','Head',9000000,7000000,true) RETURNING id`;
  const emp = async (uid, no, name, headId) => (await admin`INSERT INTO employees (tenant_id,user_id,employee_no,full_name,gross_salary,net_salary,is_post_probation,department_head_id) VALUES (${T},${uid},${no},${name},5000000,4000000,true,${headId}) RETURNING id`)[0].id;
  ids.actors = {
    head: { userId: uHead, employeeId: head.id, role: "dept_head" },
    hr: { userId: uHr, employeeId: await emp(uHr, "R", "HR", head.id), role: "hr" },
    cfo: { userId: uCfo, employeeId: await emp(uCfo, "C", "CFO", head.id), role: "cfo" },
    ceo: { userId: uCeo, employeeId: await emp(uCeo, "E", "CEO", null), role: "ceo" },
  };
  const [ri] = await admin`INSERT INTO rate_indices (tenant_id,name,current_value) VALUES (${T},'CBR',9.5) RETURNING id`;
  const [p] = await admin`INSERT INTO loan_products (tenant_id,name,kind,rate_index_id) VALUES (${T},'Dev','term',${ri.id}) RETURNING id`;
  ids.product = p.id;
  const [pl] = await admin`INSERT INTO approval_pipelines (tenant_id,loan_product_id,applies_to) VALUES (${T},${p.id},'default') RETURNING id`;
  for (const [pos, role] of [[1, "dept_head"], [2, "hr"], [3, "cfo"], [4, "ceo"]]) {
    await admin`INSERT INTO approval_stages (tenant_id,pipeline_id,position,approver_role) VALUES (${T},${pl.id},${pos},${role})`;
  }
  // Eight staff, each with one open application, at different points in the chain.
  ids.apps = [];
  for (let i = 0; i < 8; i++) {
    const [u] = await admin`INSERT INTO users (email,name,status,password_hash) VALUES (${"s" + i + "@inbox.t"},${"s" + i},'active','x') RETURNING id`;
    await admin`INSERT INTO memberships (tenant_id,user_id,role) VALUES (${T},${u.id},'employee')`;
    const eid = await emp(u.id, "S" + i, "Staff " + i, i % 3 === 0 ? null : head.id); // some have no department head
    const [a] = await admin`INSERT INTO loan_applications (tenant_id,employee_id,loan_product_id,amount,tenor_months,status) VALUES (${T},${eid},${p.id},${1000000 + i},12,'submitted') RETURNING id`;
    ids.apps.push(a.id);
  }
  // Move some along: app1 approved by head; app2 approved by head then hr; app4 rejected.
  const step = (appId, actor, decision = "approved") => inTenant((tx) => decide(tx, { tenantId: T, applicationId: appId, actor, decision, comment: decision === "rejected" ? "no" : undefined }));
  await step(ids.apps[1], ids.actors.head);
  await step(ids.apps[2], ids.actors.head); await step(ids.apps[2], ids.actors.hr);
  await step(ids.apps[4], ids.actors.head, "rejected");
});
after(async () => {
  try {
    await admin`DELETE FROM audit_log WHERE tenant_id = ${T}`;
    await admin`DELETE FROM tenants WHERE slug = 'inbox-t'`;
    await admin`DELETE FROM users WHERE email LIKE '%@inbox.t'`;
  } finally { await app.end(); await admin.end(); }
});

// The previous implementation, kept here as the reference: per application, route then canAct.
async function referenceInbox(tx, actor) {
  const rows = await tx`SELECT la.id FROM loan_applications la WHERE la.tenant_id = ${T} AND la.status IN ('submitted','in_review')`;
  const out = [];
  for (const r of rows) {
    const loaded = await routeApplication(tx, r.id);
    if (!loaded || loaded.routing.state !== "pending" || !loaded.routing.currentStage) continue;
    const applicant = { employeeId: loaded.app.employeeId, role: loaded.app.applicantRole, departmentHeadId: loaded.app.departmentHeadId };
    if (!canAct(loaded.routing.currentStage, actor, applicant)) continue;
    out.push({ id: r.id, stageRole: loaded.routing.currentStage.approverRole });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

for (const who of ["head", "hr", "cfo", "ceo"]) {
  test(`the ${who}'s inbox is exactly what the per-application method gives`, async () => {
    const actor = ids.actors[who];
    const fast = (await inTenant((tx) => inboxFor(tx, T, actor))).map((x) => ({ id: x.applicationId, stageRole: x.stageRole })).sort((a, b) => a.id.localeCompare(b.id));
    const slow = await inTenant((tx) => referenceInbox(tx, actor));
    assert.deepEqual(fast, slow);
  });
}

test("the inboxes are not all empty, and an item shows its applicant, product and wait", async () => {
  const head = await inTenant((tx) => inboxFor(tx, T, ids.actors.head));
  assert.ok(head.length >= 2, "several applications wait at the department-head stage");
  const hr = await inTenant((tx) => inboxFor(tx, T, ids.actors.hr));
  assert.ok(hr.some((x) => x.applicationId === ids.apps[1]), "the one the head approved reaches HR");
  const item = head[0];
  assert.match(item.employeeName, /^Staff \d$/);
  assert.equal(item.productName, "Dev");
  assert.ok(!Number.isNaN(Date.parse(item.waitingSince)));
  // A rejected application is nobody's inbox.
  for (const who of ["head", "hr", "cfo", "ceo"]) {
    assert.ok(!(await inTenant((tx) => inboxFor(tx, T, ids.actors[who]))).some((x) => x.applicationId === ids.apps[4]));
  }
});

test("the cost does not grow with the number of open applications: three queries", async () => {
  const { rows, n } = await app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${T}, true)`;
    queries = 0;
    const rows = await inboxFor(tx, T, ids.actors.head);
    return { rows, n: queries }; // counted inside the transaction, before its COMMIT
  });
  assert.ok(rows.length >= 2);
  assert.equal(n, 3, `inboxFor ran ${n} queries`);
});

test("by stage (the CEO's overview): every open application counted once, at the stage it waits at", async () => {
  const rows = await inTenant((tx) => tx`SELECT la.id FROM loan_applications la WHERE la.tenant_id = ${T} AND la.status IN ('submitted','in_review')`);
  const expected = {};
  for (const r of rows) {
    const loaded = await inTenant((tx) => routeApplication(tx, r.id));
    if (!loaded || loaded.routing.state !== "pending" || !loaded.routing.currentStage) continue;
    const role = loaded.routing.currentStage.approverRole;
    expected[role] = (expected[role] ?? 0) + 1;
  }
  const stages = await inTenant((tx) => openApplicationsByStage(tx, T));
  assert.deepEqual(Object.fromEntries(stages.map((s) => [s.stageRole, s.count])), expected);
  assert.ok(stages.length >= 2, "applications wait at more than one stage");
  for (const s of stages) {
    assert.ok(s.amount > 0 && s.oldestHours >= 0 && s.overdue === 0, `${s.stageRole}: amount, wait, no time limit set`);
  }
});
