// The HR register also flags: a temporary employee number, a record loaded with a note that needs a
// decision, and staff with no work email (who therefore cannot be invited). Each clears when HR fixes it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { registerHealth } from "../src/hr-register.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL, APP = process.env.DATABASE_URL;
let admin, app, T;
const health = () => app.begin(async (tx) => { await tx`SELECT set_config('app.tenant_id', ${T}, true)`; return registerHealth(tx, T); });
const emp = (no, name, extra = {}) => admin`INSERT INTO employees (tenant_id,employee_no,full_name,gross_salary,net_salary,work_email,review_note,user_id)
  VALUES (${T},${no},${name},1000,800,${extra.email ?? null},${extra.note ?? null},${extra.user ?? null}) RETURNING id`;

before(async () => {
  admin = postgres(ADMIN, { max: 1 }); app = postgres(APP, { max: 2 });
  await admin`DELETE FROM tenants WHERE slug = 'flag-t'`;
  await admin`DELETE FROM users WHERE email LIKE '%@flag.t'`;
  [{ id: T }] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('flag-t','Flags','active') RETURNING id`;
});
after(async () => {
  await admin`DELETE FROM tenants WHERE slug = 'flag-t'`; await admin`DELETE FROM users WHERE email LIKE '%@flag.t'`;
  await app.end(); await admin.end();
});

test("a temporary number, a note and a missing email are each flagged, by name", async () => {
  await emp("TEMP-001", "No Number");
  await emp("F1", "Has Note", { note: "Line manager 'SENIOR ACCOUNTANT' matches nobody", email: "a@flag.t" });
  await emp("F2", "All Good", { email: "b@flag.t" });
  const [u] = await admin`INSERT INTO users (email,name,status,password_hash) VALUES ('c@flag.t','C','active','x') RETURNING id`;
  await emp("F3", "Has Login", { user: u.id }); // a login means no email needed

  const h = await health();
  assert.deepEqual(h.provisionalNoPeople.map((p) => p.employeeNo), ["TEMP-001"]);
  assert.deepEqual(h.reviewPeople.map((p) => [p.name, p.note]), [["Has Note", "Line manager 'SENIOR ACCOUNTANT' matches nobody"]]);
  assert.deepEqual(h.missingEmailPeople.map((p) => p.name), ["No Number"], "only people with neither a login nor an email on file");
});

test("each flag clears once HR fixes it", async () => {
  await admin`UPDATE employees SET employee_no = 'MUA099', work_email = 'n@flag.t' WHERE employee_no = 'TEMP-001' AND tenant_id = ${T}`;
  await admin`UPDATE employees SET review_note = NULL WHERE employee_no = 'F1' AND tenant_id = ${T}`;
  const h = await health();
  assert.equal(h.provisionalNoPeople.length, 0); assert.equal(h.reviewPeople.length, 0); assert.equal(h.missingEmailPeople.length, 0);
});

test("an exited employee is not flagged", async () => {
  await emp("TEMP-002", "Gone");
  await admin`UPDATE employees SET status = 'exited' WHERE employee_no = 'TEMP-002' AND tenant_id = ${T}`;
  assert.equal((await health()).provisionalNoPeople.length, 0);
});

test("the importer's rule for notes: set when someone is first loaded, never re-set on a later import", async () => {
  // The same upsert the Employees import runs (employees-actions.ts): the conflict branch leaves review_note alone.
  const upsert = (note, email) => admin`
    INSERT INTO employees (tenant_id, employee_no, full_name, gross_salary, net_salary, work_email, review_note)
    VALUES (${T}, 'IMP1', 'Imported', 0, 0, ${email}, ${note})
    ON CONFLICT (tenant_id, employee_no) DO UPDATE SET
      work_email = COALESCE(EXCLUDED.work_email, employees.work_email), full_name = EXCLUDED.full_name`;
  await upsert("two managers", null);
  await admin`UPDATE employees SET review_note = NULL WHERE employee_no = 'IMP1' AND tenant_id = ${T}`; // HR settles it
  await admin`UPDATE employees SET work_email = 'typed@flag.t' WHERE employee_no = 'IMP1' AND tenant_id = ${T}`; // HR types the email
  await upsert("two managers", null); // the same file is imported again
  const [r] = await admin`SELECT review_note, work_email FROM employees WHERE employee_no = 'IMP1' AND tenant_id = ${T}`;
  assert.equal(r.review_note, null, "a settled note does not come back");
  assert.equal(r.work_email, "typed@flag.t", "a blank email in the file never erases one HR typed");
});
