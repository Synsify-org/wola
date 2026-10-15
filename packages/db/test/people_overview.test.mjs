// packages/db/test/people_overview.test.mjs
// peopleOverview() feeds the people side of the CEO's overview. Proves: headcount and
// borrowers count active staff only; uptake is per department; a person who has left with
// a running loan is counted as a balance left behind (at its ledger outstanding); and RLS
// keeps it per tenant. Real DB, file-scoped slugs, cleans up only its own rows.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { peopleOverview } from "../src/metrics.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
const SLUGS = ["people-a", "people-b"];
let admin, app, T, OTHER, prod;

const inTenant = (tid, fn) =>
  app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tid}, true)`;
    return fn(tx);
  });

async function employee(no, department, status = "active") {
  const [e] = await admin`INSERT INTO employees (tenant_id,employee_no,full_name,department,gross_salary,net_salary,status)
    VALUES (${T},${no},${"Person " + no},${department},5000000,3500000,${status}) RETURNING id`;
  return e.id;
}
async function loan(employeeId, principal, status = "active") {
  const [a] = await admin`INSERT INTO loan_applications (tenant_id,employee_id,loan_product_id,amount,tenor_months,status)
    VALUES (${T},${employeeId},${prod},${principal},12,'approved') RETURNING id`;
  const [l] = await admin`INSERT INTO loans (tenant_id,application_id,principal,annual_rate,rate_mode,start_date,tenor_months,status)
    VALUES (${T},${a.id},${principal},0.1,'fixed','2026-01-15',12,${status}) RETURNING id`;
  return l.id;
}

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 2 });
  for (const s of SLUGS) await admin`DELETE FROM tenants WHERE slug = ${s}`;
  [{ id: T }] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('people-a','People A','active') RETURNING id`;
  [{ id: OTHER }] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('people-b','People B','active') RETURNING id`;
  [{ id: prod }] = await admin`INSERT INTO loan_products (tenant_id,name,kind) VALUES (${T},'Dev','term') RETURNING id`;

  // Ops: 3 staff, 2 borrowing (one with two loans). Finance: 1 staff, none borrowing.
  const a = await employee("A", "Ops"), b = await employee("B", "Ops");
  await employee("C", "Ops"); await employee("D", "Finance");
  await loan(a, 1_000_000); await loan(a, 500_000);
  const bl = await loan(b, 2_000_000);
  await admin`INSERT INTO repayments (tenant_id,loan_id,source,amount,value_date,allocation)
    VALUES (${T},${bl},'payroll',300000,'2026-02-15',${admin.json({ interest: 0, principal: 300000 })})`;
  // A settled loan is not "borrowing".
  await loan(await employee("E", "Finance"), 400_000, "settled");
  // Someone who left with a running loan, 100,000 already repaid.
  const gone = await employee("X", "Ops", "exited");
  const gl = await loan(gone, 800_000);
  await admin`INSERT INTO repayments (tenant_id,loan_id,source,amount,value_date,allocation)
    VALUES (${T},${gl},'payroll',100000,'2026-02-15',${admin.json({ interest: 0, principal: 100000 })})`;
});
after(async () => {
  for (const s of SLUGS) await admin`DELETE FROM tenants WHERE slug = ${s}`;
  await app.end();
  await admin.end();
});

test("headcount and borrowers count active staff only; uptake is per department", async () => {
  const p = await inTenant(T, (tx) => peopleOverview(tx));
  assert.equal(p.headcount, 5, "A, B, C, D, E (X has left)");
  assert.equal(p.borrowers, 2, "A and B; E's loan is settled");
  const ops = p.byDepartment.find((d) => d.department === "Ops");
  assert.deepEqual({ headcount: ops.headcount, borrowers: ops.borrowers }, { headcount: 3, borrowers: 2 });
  assert.equal(ops.outstanding, 1_000_000 + 500_000 + 1_700_000, "ledger outstanding, not principal");
  const fin = p.byDepartment.find((d) => d.department === "Finance");
  assert.deepEqual({ headcount: fin.headcount, borrowers: fin.borrowers, outstanding: fin.outstanding }, { headcount: 2, borrowers: 0, outstanding: 0 });
});

test("a person who left with a running loan is a balance left behind", async () => {
  const p = await inTenant(T, (tx) => peopleOverview(tx));
  assert.deepEqual(p.leaversWithBalance, { people: 1, outstanding: 700_000 });
});

test("another tenant sees none of it", async () => {
  const p = await inTenant(OTHER, (tx) => peopleOverview(tx));
  assert.deepEqual(p, { headcount: 0, borrowers: 0, byDepartment: [], leaversWithBalance: { people: 0, outstanding: 0 } });
});
