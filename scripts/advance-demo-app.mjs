// scripts/advance-demo-app.mjs
// Advances one pending demo application through its approval chain so it lands
// at the CFO stage (for demoing the CFO worklist). Uses the REAL decide()
// path so the approvals are engine-valid, not hand-inserted.
//
// Usage: node --import tsx --import dotenv/config scripts/advance-demo-app.mjs
import postgres from "postgres";
import { tenantTx, decide } from "@wola/db";
import "dotenv/config";

const APP = process.env.DATABASE_URL;
const T_SLUG = "testco";
const sql = postgres(process.env.DATABASE_ADMIN_URL, { max: 1 });

const [t] = await sql`SELECT id FROM tenants WHERE slug = ${T_SLUG}`;
const appDb = postgres(APP, { max: 2 });

// The term application from Staff Member, currently 'submitted' at dept_head.
const [target] = await sql`
  SELECT la.id, la.employee_id
  FROM loan_applications la
  JOIN loan_products lp ON lp.id = la.loan_product_id
  WHERE la.tenant_id = ${t.id} AND lp.kind = 'term'
    AND la.status IN ('submitted','in_review')
  LIMIT 1`;
if (!target) { console.error("no pending term app found"); process.exit(1); }

// Approvers: resolve their user + employee ids + roles.
async function actor(email, role) {
  const [u] = await sql`SELECT id FROM users WHERE email = ${email}`;
  const [e] = await sql`
    SELECT id FROM employees WHERE tenant_id = ${t.id} AND user_id = ${u.id}`;
  return { userId: u.id, employeeId: e?.id ?? null, role };
}

const head = await actor("head@testco.io", "dept_head");
const hr = await actor("hr@testco.io", "hr");

// Drive real approvals inside the tenant RLS scope.
async function approve(who) {
  return tenantTx(appDb, t.id, (tx) =>
    decide(tx, {
      tenantId: t.id,
      applicationId: target.id,
      actor: who,
      decision: "approved",
    }),
  );
}

const r1 = await approve(head);
console.log("dept_head:", r1.ok ? r1.routing.state : r1.error);
const r2 = await approve(hr);
console.log("hr:", r2.ok ? r2.routing.state : r2.error);
console.log("application", target.id, "should now be at the CFO stage");

await sql.end();
await appDb.end();
