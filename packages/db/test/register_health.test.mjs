import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { registerHealth } from "../src/hr-register.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
let admin, app, T;

const inTenant = (fn) =>
  app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${T}, true)`;
    return fn(tx);
  });

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 2 });
  await admin`DELETE FROM tenants WHERE slug = 'reg-t'`;
  await admin`DELETE FROM users WHERE email LIKE '%@reg.t'`;
  const [t] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('reg-t','Reg Test','active') RETURNING id`;
  T = t.id;

  const user = async (email, role) => {
    const [u] = await admin`INSERT INTO users (email,name,status,password_hash) VALUES (${email}, ${email}, 'active', 'x') RETURNING id`;
    await admin`INSERT INTO memberships (tenant_id,user_id,role) VALUES (${T}, ${u.id}, ${role})`;
    return u.id;
  };
  const uCeo = await user("ceo@reg.t", "ceo");
  const uHead = await user("head@reg.t", "dept_head");
  const uGap = await user("gap@reg.t", "employee");

  // The CEO: nobody above them, so no department head — and that is correct.
  await admin`INSERT INTO employees (tenant_id,user_id,employee_no,full_name,gross_salary,net_salary)
    VALUES (${T},${uCeo},'E1','Chief Executive',20000000,16000000)`;
  const [head] = await admin`INSERT INTO employees (tenant_id,user_id,employee_no,full_name,gross_salary,net_salary)
    VALUES (${T},${uHead},'H1','Dept Head',9000000,7000000) RETURNING id`;
  // A fine employee, with a head.
  await admin`INSERT INTO employees (tenant_id,employee_no,full_name,gross_salary,net_salary,department_head_id)
    VALUES (${T},'S1','Has Head',5000000,4000000,${head.id})`;
  // Two genuine gaps: no head (a plain employee), and no salary on file.
  await admin`INSERT INTO employees (tenant_id,user_id,employee_no,full_name,gross_salary,net_salary)
    VALUES (${T},${uGap},'S2','No Head',5000000,4000000)`;
  await admin`INSERT INTO employees (tenant_id,employee_no,full_name,gross_salary,net_salary,department_head_id)
    VALUES (${T},'S3','No Salary',0,0,${head.id})`;
});

after(async () => {
  await app.end();
  await admin.end();
});

test("the CEO is not flagged as missing a department head; a real gap is, by name", async () => {
  const h = await inTenant((tx) => registerHealth(tx, T));
  const names = h.missingDeptHeadPeople.map((p) => p.name);
  assert.ok(!names.includes("Chief Executive"), "top-of-chain roles have no department head by design");
  assert.ok(names.includes("No Head"));
  // The department head themself also has nobody above them in this fixture —
  // flagged as a genuine gap, since they hold no top-of-chain role.
  assert.ok(names.includes("Dept Head"));
  assert.equal(h.missingDeptHead, h.missingDeptHeadPeople.length);
});

test("missing salary is reported with the person's name and employee number", async () => {
  const h = await inTenant((tx) => registerHealth(tx, T));
  assert.deepEqual(h.missingSalaryPeople.map((p) => [p.name, p.employeeNo]), [["No Salary", "S3"]]);
  assert.equal(h.missingSalary, 1);
  assert.equal(h.headcount, 5);
});
