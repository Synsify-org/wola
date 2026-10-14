// Inviting many people from a list: reading the file and checking every row against the organisation.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { parseBulkInvites, planBulkInvites, MAX_BULK_INVITES } from "../src/bulk-invite.ts";
import { inviteToOrganisation } from "../src/access-admin.ts";
import { tenantTx } from "../src/client.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL, APP = process.env.DATABASE_URL;
let admin, app, T, ids = {};

before(async () => {
  admin = postgres(ADMIN, { max: 1 }); app = postgres(APP, { max: 2 });
  await admin`DELETE FROM tenants WHERE slug = 'bulk-t'`;
  await admin`DELETE FROM users WHERE email LIKE '%@bulk.t'`;
  [{ id: T }] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('bulk-t','Bulk','active') RETURNING id`;
  const emp = async (no, name, userId = null) => (await admin`INSERT INTO employees (tenant_id,user_id,employee_no,full_name,gross_salary,net_salary) VALUES (${T},${userId},${no},${name},1,1) RETURNING id`)[0].id;
  for (const [no, n] of [["B1", "Ann One"], ["B2", "Bo Two"], ["B3", "Cy Three"], ["B4", "Di Four"], ["B5", "Ed Five"], ["B6", "Flo Six"]]) ids[no] = await emp(no, n);
  const [u] = await admin`INSERT INTO users (email,name,status,password_hash) VALUES ('has@bulk.t','Has Login','active','x') RETURNING id`;
  ids.B7 = await emp("B7", "Gus Seven", u.id);
  const [m] = await admin`INSERT INTO users (email,name,status,password_hash) VALUES ('member@bulk.t','Member','active','x') RETURNING id`;
  await admin`INSERT INTO memberships (tenant_id,user_id,role) VALUES (${T},${m.id},'cfo')`;
  const [inviter] = await admin`INSERT INTO users (email,name,status,password_hash) VALUES ('inviter@bulk.t','Inviter','active','x') RETURNING id`;
  ids.inviter = inviter.id;
});
after(async () => {
  await admin`DELETE FROM tenants WHERE slug = 'bulk-t'`;
  await admin`DELETE FROM users WHERE email LIKE '%@bulk.t'`;
  await app.end(); await admin.end();
});

test("it reads the accounts.csv the staff tool writes, skipping people with no email yet", () => {
  const csv = "employee_no,full_name,title,work_email,suggested_role,why\r\nMUA 001,Ann,CEO,ANN@Mua.test,ceo,x\nMUA002,Bo,Clerk,,employee,x\n\nMUA003,Cy,Clerk,cy@mua.test,,x\n";
  const r = parseBulkInvites(csv);
  assert.deepEqual(r.rows.map((x) => [x.employeeNo, x.email, x.role]), [["MUA001", "ann@mua.test", "ceo"], ["MUA002", "", "employee"], ["MUA003", "cy@mua.test", "employee"]], "a blank email is kept: it may be on the employee's record");
  assert.deepEqual(r.errors, []);
  assert.deepEqual(parseBulkInvites("employee_no,role\nA1,hr").rows.map((x) => [x.employeeNo, x.email, x.role]), [["A1", "", "hr"]], "the email column itself is optional");
});

test("a list without the needed columns, an empty list, or one that is too long, is refused with a reason", () => {
  assert.match(parseBulkInvites("name,phone\nA,1").errors[0], /employee_no/);
  assert.match(parseBulkInvites("").errors[0], /empty/);
  const big = "employee_no,email\n" + Array.from({ length: MAX_BULK_INVITES + 1 }, (_, i) => `E${i},p${i}@x.test`).join("\n");
  assert.match(parseBulkInvites(big).errors[0], /At most/);
});

test("every row is checked against the organisation, and each problem says what to do", async () => {
  // B6 already has a live invitation
  await tenantTx(app, T, (tx) => inviteToOrganisation(tx, { tenantId: T, invitedById: ids.inviter, email: "waiting@bulk.t", role: "employee", employeeId: ids.B6 }));
  const rows = parseBulkInvites([
    "employee_no,work_email,role",
    "B1,ann@bulk.t,employee",         // fine
    "B2,not-an-email,employee",       // bad email
    "ZZ9,zed@bulk.t,employee",        // no such employee
    "B3,cy@bulk.t,wizard",            // no such role
    "B7,gus@bulk.t,employee",         // already has a login
    "B4,member@bulk.t,employee",      // that email already has access here
    "B6,waiting@bulk.t,employee",     // a live invitation is already out
    "B5,ann@bulk.t,employee",         // the same email as line 2 (B1)
    "B1,other@bulk.t,employee",       // the same employee again
  ].join("\n")).rows;
  const plan = await tenantTx(app, T, (tx) => planBulkInvites(tx, T, rows));
  const by = (no, email) => plan.find((p) => p.employeeNo === no && p.email === email);
  assert.equal(by("B1", "ann@bulk.t").problem, null);
  assert.equal(by("B1", "ann@bulk.t").name, "Ann One");
  assert.match(by("B2", "not-an-email").problem, /not a valid email/);
  assert.match(by("ZZ9", "zed@bulk.t").problem, /No employee ZZ9/);
  assert.match(by("B3", "cy@bulk.t").problem, /not a role/);
  assert.match(by("B7", "gus@bulk.t").problem, /Already has a login/);
  assert.match(by("B4", "member@bulk.t").problem, /already has access/);
  assert.match(by("B6", "waiting@bulk.t").problem, /already waiting/);
  assert.match(by("B5", "ann@bulk.t").problem, /same email is used on line 2/);
  assert.match(by("B1", "other@bulk.t").problem, /appears again/);
});

test("an email already saved on the employee is used when the list has none; no email anywhere means skipped, not an error", async () => {
  await admin`UPDATE employees SET work_email = 'Stored@Bulk.T' WHERE id = ${ids.B4}`;
  const rows = parseBulkInvites("employee_no,role\nB4,hr\nB5,employee").rows; // B4 has an email on file, B5 has none
  const plan = await tenantTx(app, T, (tx) => planBulkInvites(tx, T, rows));
  const b4 = plan.find((p) => p.employeeNo === "B4"), b5 = plan.find((p) => p.employeeNo === "B5");
  assert.equal(b4.email, "stored@bulk.t"); assert.equal(b4.problem, null); assert.equal(b4.skipped, false);
  assert.equal(b5.problem, null); assert.equal(b5.skipped, true);
  await admin`UPDATE employees SET work_email = NULL WHERE id = ${ids.B4}`;
});

test("checking the list writes nothing", async () => {
  const before = await admin`SELECT count(*)::int AS n FROM invitations WHERE tenant_id = ${T}`;
  const rows = parseBulkInvites("employee_no,work_email\nB1,fresh@bulk.t\nB2,fresh2@bulk.t").rows;
  const plan = await tenantTx(app, T, (tx) => planBulkInvites(tx, T, rows));
  assert.equal(plan.filter((p) => !p.problem).length, 2);
  const after = await admin`SELECT count(*)::int AS n FROM invitations WHERE tenant_id = ${T}`;
  assert.equal(after[0].n, before[0].n);
});

test("another organisation's staff are never visible to the check", async () => {
  const [{ id: other }] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('bulk-o','Other','active') RETURNING id`;
  try {
    const plan = await tenantTx(app, other, (tx) => planBulkInvites(tx, other, [{ line: 2, employeeNo: "B1", email: "x@bulk.t", role: "employee" }]));
    assert.match(plan[0].problem, /No employee B1/);
  } finally { await admin`DELETE FROM tenants WHERE slug = 'bulk-o'`; }
});
