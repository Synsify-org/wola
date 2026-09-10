// packages/db/test/notifications.test.mjs
// Proves decide() actually enqueues the right emails at each stage — the
// legacy pain point named in Wola.pdf ("no notification system"). Same
// fixture shape as approval_flow.test.mjs (dept_head -> hr -> cfo -> ceo),
// own tenant slug per the file-scoping convention in DECISIONS.md.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { decide } from "../src/approvals.ts";

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

  await admin`DELETE FROM tenants WHERE slug = 'notif-t'`;
  await admin`DELETE FROM users WHERE email LIKE '%@notif.t'`;
  const [t] = await admin`INSERT INTO tenants (slug,name,status)
    VALUES ('notif-t','Notif Test','active') RETURNING id`;
  T = t.id;

  const mk = async (email, role) => {
    const [u] = await admin`INSERT INTO users (email,name,status,password_hash)
      VALUES (${email}, ${email}, 'active', 'x') RETURNING id`;
    await admin`INSERT INTO memberships (tenant_id,user_id,role)
      VALUES (${T}, ${u.id}, ${role})`;
    return u.id;
  };
  ids.uStaff = await mk("staff@notif.t", "employee");
  ids.uHead = await mk("head@notif.t", "dept_head");
  ids.uHr = await mk("hr@notif.t", "hr");
  ids.uCfo = await mk("cfo@notif.t", "cfo");
  ids.uCeo = await mk("ceo@notif.t", "ceo");

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

  const [ri] = await admin`INSERT INTO rate_indices (tenant_id,name,current_value)
    VALUES (${T},'CBR',9.500) RETURNING id`;
  const [p] = await admin`INSERT INTO loan_products (tenant_id,name,kind,rate_index_id)
    VALUES (${T},'Dev Loan','term',${ri.id}) RETURNING id`;
  ids.product = p.id;
  const [pl] = await admin`INSERT INTO approval_pipelines (tenant_id,loan_product_id,applies_to)
    VALUES (${T},${p.id},'default') RETURNING id`;
  for (const [pos, role] of [[1, "dept_head"], [2, "hr"], [3, "cfo"], [4, "ceo"]]) {
    await admin`INSERT INTO approval_stages (tenant_id,pipeline_id,position,approver_role)
      VALUES (${T},${pl.id},${pos},${role})`;
  }
});

after(async () => {
  await app.end();
  await admin.end();
});

const newApplication = async () => {
  const [a] = await admin`INSERT INTO loan_applications
    (tenant_id,employee_id,loan_product_id,amount,tenor_months,status)
    VALUES (${T},${ids.eStaff},${ids.product},10000000,24,'submitted') RETURNING id`;
  return a.id;
};
const actor = (userId, employeeId, role) => ({ userId, employeeId, role });
// uuid has no MAX() aggregate, so mark "since" with a timestamp instead of an id.
const outboxSince = (fromTs) => admin`SELECT to_email, subject, body_html FROM email_outbox WHERE tenant_id = ${T} AND created_at > ${fromTs} ORDER BY created_at`;
const markNow = async () => {
  const [row] = await admin`SELECT now() AS ts`;
  return row.ts;
};

test("advancing to the next stage notifies only that stage's approver", async () => {
  const appId = await newApplication();
  const before = await markNow();

  const r = await inTenant((tx) => decide(tx, {
    tenantId: T, applicationId: appId,
    actor: actor(ids.uHead, ids.eHead, "dept_head"), decision: "approved",
  }));
  assert.equal(r.ok, true);

  const mail = await outboxSince(before);
  assert.equal(mail.length, 1, "exactly one notification for one stage advance");
  assert.equal(mail[0].to_email, "hr@notif.t");
  assert.match(mail[0].subject, /Awaiting your decision/);
  assert.match(mail[0].body_html, /Staff/); // applicant name rendered, not a literal {{applicantName}}
});

test("HR approving notifies the CFO next", async () => {
  const appId = await newApplication();
  await inTenant((tx) => decide(tx, {
    tenantId: T, applicationId: appId,
    actor: actor(ids.uHead, ids.eHead, "dept_head"), decision: "approved",
  }));
  const before = await markNow();

  await inTenant((tx) => decide(tx, {
    tenantId: T, applicationId: appId,
    actor: actor(ids.uHr, ids.eHr, "hr"), decision: "approved",
  }));

  const mail = await outboxSince(before);
  assert.equal(mail.length, 1);
  assert.equal(mail[0].to_email, "cfo@notif.t");
});

test("final approval notifies the applicant, CFO, HR, and the department head", async () => {
  const appId = await newApplication();
  const step = (uid, eid, role) => inTenant((tx) => decide(tx, {
    tenantId: T, applicationId: appId,
    actor: actor(uid, eid, role), decision: "approved",
  }));
  await step(ids.uHead, ids.eHead, "dept_head");
  await step(ids.uHr, ids.eHr, "hr");
  await step(ids.uCfo, ids.eCfo, "cfo");

  const before = await markNow();
  const last = await inTenant((tx) => decide(tx, {
    tenantId: T, applicationId: appId,
    actor: actor(ids.uCeo, ids.eCeo, "ceo"), decision: "approved",
    startDate: new Date("2026-08-01"),
  }));
  assert.equal(last.ok, true);

  const mail = await outboxSince(before);
  const recipients = mail.map((m) => m.to_email).sort();
  assert.deepEqual(recipients, ["cfo@notif.t", "hr@notif.t", "staff@notif.t"].concat(["head@notif.t"]).sort());

  const applicantMail = mail.find((m) => m.to_email === "staff@notif.t");
  assert.match(applicantMail.subject, /has been approved/);
  const staffMail = mail.find((m) => m.to_email === "cfo@notif.t");
  assert.match(staffMail.subject, /Staff.*has been approved/);
});

test("a rejection notifies the applicant with the reason", async () => {
  const appId = await newApplication();
  const before = await markNow();

  const r = await inTenant((tx) => decide(tx, {
    tenantId: T, applicationId: appId,
    actor: actor(ids.uHead, ids.eHead, "dept_head"),
    decision: "rejected", comment: "Existing exposure too high.",
  }));
  assert.equal(r.ok, true);

  const mail = await outboxSince(before);
  assert.equal(mail.length, 1);
  assert.equal(mail[0].to_email, "staff@notif.t");
  assert.match(mail[0].subject, /not approved/);
  assert.match(mail[0].body_html, /Existing exposure too high\./);
});

test("another tenant cannot see these notification emails", async () => {
  const [other] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('notif-b','Notif B','active') RETURNING id`;
  const seenByOther = await app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${other.id}, true)`;
    return tx`SELECT * FROM email_outbox WHERE tenant_id = ${T}`;
  });
  assert.equal(seenByOther.length, 0);
  await admin`DELETE FROM tenants WHERE slug = 'notif-b'`;
});
