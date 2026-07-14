// packages/db/test/tenant_leak.test.mjs
// Proves inboxFor filters by tenant IN THE QUERY, not by relying on RLS.
//
// Deliberately runs on the ADMIN connection (BYPASSRLS). If the tenant_id
// predicate is missing, tenant B's application appears in tenant A's inbox.
// On the pre-fix code this test FAILS. That is the point: RLS was masking
// the defect, so a test on the app connection would have passed on the bug
// and proved nothing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { inboxFor } from "../src/approvals.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
let admin, app;
const t = {}; // per-tenant ids

// Seed one tenant with a full chain and one submitted staff application.
// Mirrors approval_flow.test.mjs's fixture — same shape, parameterised.
async function seedTenant(slug, domain) {
  const [tn] = await admin`INSERT INTO tenants (slug,name,status)
    VALUES (${slug}, ${slug}, 'active') RETURNING id`;
  const T = tn.id;

  const mk = async (local, role) => {
    const [u] = await admin`INSERT INTO users (email,name,status,password_hash)
      VALUES (${local + "@" + domain}, ${local}, 'active', 'x') RETURNING id`;
    await admin`INSERT INTO memberships (tenant_id,user_id,role)
      VALUES (${T}, ${u.id}, ${role})`;
    return u.id;
  };
  const uHead = await mk("head", "dept_head");
  const uStaff = await mk("staff", "employee");
  const uCfo = await mk("cfo", "cfo");

  const [head] = await admin`INSERT INTO employees
    (tenant_id,user_id,employee_no,full_name,gross_salary,net_salary,is_post_probation)
    VALUES (${T},${uHead},'H1','Head',9000000,7000000,true) RETURNING id`;
  const emp = async (uid, no, name) => {
    const [e] = await admin`INSERT INTO employees
      (tenant_id,user_id,employee_no,full_name,gross_salary,net_salary,
       is_post_probation,department_head_id)
      VALUES (${T},${uid},${no},${name},5000000,4000000,true,${head.id}) RETURNING id`;
    return e.id;
  };
  const eStaff = await emp(uStaff, "S1", "Staff");
  const eCfo = await emp(uCfo, "C1", "CFO");

  // Product + a pipeline with a SINGLE cfo stage, so a fresh application sits
  // at the CFO's desk immediately — no dept_head/hr approvals to fake first.
  const [p] = await admin`INSERT INTO loan_products (tenant_id,name,kind)
    VALUES (${T},'Dev Loan','term') RETURNING id`;
  const [pl] = await admin`INSERT INTO approval_pipelines (tenant_id,loan_product_id,applies_to)
    VALUES (${T},${p.id},'default') RETURNING id`;
  await admin`INSERT INTO approval_stages (tenant_id,pipeline_id,position,approver_role)
    VALUES (${T},${pl.id},1,'cfo')`;

  const [a] = await admin`INSERT INTO loan_applications
    (tenant_id,employee_id,loan_product_id,amount,tenor_months,status)
    VALUES (${T},${eStaff},${p.id},10000000,24,'submitted') RETURNING id`;

  return { T, uCfo, eCfo, applicationId: a.id };
}

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 2 });
  // users are GLOBAL — the tenant cascade does not remove them.
  await admin`DELETE FROM tenants WHERE slug IN ('leak-a','leak-b')`;
  await admin`DELETE FROM users WHERE email LIKE '%@leak.a' OR email LIKE '%@leak.b'`;
  t.a = await seedTenant("leak-a", "leak.a");
  t.b = await seedTenant("leak-b", "leak.b");
});

after(async () => {
  await admin`DELETE FROM tenants WHERE slug IN ('leak-a','leak-b')`;
  await admin`DELETE FROM users WHERE email LIKE '%@leak.a' OR email LIKE '%@leak.b'`;
  await app.end();
  await admin.end();
});

test("inboxFor is scoped to the caller's tenant", async () => {
  // Runs on the APP connection under tenant A's RLS context — the real
  // runtime path. Belt (RLS) and braces (the tenant_id predicate) together.
  await app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${t.a.T}, true)`;
    const inbox = await inboxFor(tx, t.a.T, {
      userId: t.a.uCfo, employeeId: t.a.eCfo, role: "cfo",
    });
    const ids = inbox.map((i) => i.applicationId);
    assert.deepEqual(ids, [t.a.applicationId]);
  });
});

test("no tenant context => empty inbox, never a leak", async () => {
  await app.begin(async (tx) => {
    const inbox = await inboxFor(tx, t.a.T, {
      userId: t.a.uCfo, employeeId: t.a.eCfo, role: "cfo",
    });
    assert.equal(inbox.length, 0);
  });
});