// Practice loans and payroll history for a TRIAL organisation: built with the real code paths, safe by construction.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { tenantSql } from "../../../scripts/lib/tenant-sql.mjs";
import { loadPracticeBook, loadPayrollHistory } from "../src/practice-data.ts";
import { cycleReport, arrearsByLoan } from "../src/payroll.ts";
import { tenantTx } from "../src/client.ts";
import { verifyPassword } from "../src/auth.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL, APP = process.env.DATABASE_URL;
const SLUG = "pd-trial", TODAY = new Date("2026-10-14T00:00:00Z");
let admin, app, T;
const input = { slug: SLUG, name: "Practice Co (Trial)", adminEmail: "owner@pd.example.com", adminName: "Owner", origin: "https://pd-trial.example.com", template: "benefit-scheme", token: "c".repeat(64), trial: true };

const wipe = async () => {
  // audit_log has no cascade (append-only); everything else goes with the organisation.
  await admin`DELETE FROM audit_log WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN (${SLUG}, 'pd-real', 'pd-small'))`;
  await admin`DELETE FROM tenants WHERE slug IN (${SLUG}, 'pd-real', 'pd-small')`;
  await admin`DELETE FROM users WHERE email LIKE 'practice.%@pd-%.invalid'`;
};
const staff = async (tid, n) => {
  const depts = ["Finance", "Operations", "Commercial"];
  const heads = [];
  for (const [i, d] of depts.entries()) {
    const [h] = await admin`INSERT INTO employees (tenant_id,employee_no,full_name,department,title,gross_salary,net_salary,is_post_probation) VALUES (${tid},${"H" + i},${"Head " + d},${d},'Manager',9000000,7000000,true) RETURNING id`;
    heads.push(h.id);
  }
  for (let i = 0; i < n; i++) {
    await admin`INSERT INTO employees (tenant_id,employee_no,full_name,department,title,gross_salary,net_salary,is_post_probation,department_head_id)
      VALUES (${tid},${"S" + String(i).padStart(2, "0")},${"Staff " + i},${depts[i % 3]},'Officer',${3000000 + i * 100000},${2400000 + i * 80000},true,${heads[i % 3]})`;
  }
  // on probation: must never be picked; suspended: never picked either
  await admin`INSERT INTO employees (tenant_id,employee_no,full_name,department,gross_salary,net_salary,is_post_probation,department_head_id) VALUES (${tid},'PROB1','On Probation','Finance',3000000,2400000,false,${heads[0]})`;
  await admin`INSERT INTO employees (tenant_id,employee_no,full_name,department,gross_salary,net_salary,is_post_probation,status,department_head_id) VALUES (${tid},'SUSP1','Suspended','Finance',3000000,2400000,true,'suspended',${heads[0]})`;
};

before(async () => {
  admin = postgres(ADMIN, { max: 1 }); app = postgres(APP, { max: 3 });
  await wipe();
  await admin.unsafe(tenantSql(input).sql);
  [{ id: T }] = await admin`SELECT id FROM tenants WHERE slug = ${SLUG}`;
  await staff(T, 18);
});
after(async () => { try { await wipe(); } finally { await app.end(); await admin.end(); } });

let summary;
test("a trial organisation gets a believable book through the real code paths", async () => {
  summary = await loadPracticeBook(app, T, { today: TODAY });
  assert.equal(summary.historyLoans, 7);
  assert.equal(summary.awaitingDisbursement, 1);
  assert.equal(summary.inFlight, 5);
  assert.equal(summary.rejected, 1);
  assert.ok(summary.payrollMonths >= 5 && summary.deductions > 15, JSON.stringify(summary));

  const loans = await admin`SELECT status, count(*)::int AS n FROM loans WHERE tenant_id = ${T} GROUP BY status ORDER BY status`;
  const by = Object.fromEntries(loans.map((l) => [l.status, l.n]));
  assert.equal(by.pending_disbursement, 1, "one loan waits for finance to disburse it");
  assert.ok((by.active ?? 0) >= 5 && (by.settled ?? 0) >= 1, JSON.stringify(by));
  const apps = await admin`SELECT status, count(*)::int AS n FROM loan_applications WHERE tenant_id = ${T} GROUP BY status`;
  const a = Object.fromEntries(apps.map((x) => [x.status, x.n]));
  assert.equal(a.rejected, 1); assert.ok(a.submitted + (a.in_review ?? 0) === 5, JSON.stringify(a));
});

test("applications sit at different stages, each decided by the real engine", async () => {
  const stages = await admin`
    SELECT la.id, count(a.id)::int AS decisions FROM loan_applications la
    LEFT JOIN approvals a ON a.application_id = la.id AND a.decision = 'approved'
    WHERE la.tenant_id = ${T} AND la.status IN ('submitted','in_review') GROUP BY la.id ORDER BY 2`;
  assert.deepEqual(stages.map((s) => s.decisions), [0, 0, 1, 2, 3], "two at the department head, then HR, CFO and CEO");
  const rej = await admin`SELECT comment FROM approvals WHERE tenant_id = ${T} AND decision = 'rejected'`;
  assert.equal(rej.length, 1); assert.match(rej[0].comment, /apply again/);
});

test("last month is left imperfect on purpose: one missed and one short deduction to resolve", async () => {
  const rep = await tenantTx(app, T, (tx) => cycleReport(tx, T, "2026-09", "2026-10-14"));
  const statuses = rep.lines.map((l) => l.status);
  assert.ok(statuses.includes("missed"), "a missed deduction");
  assert.ok(statuses.includes("short"), "a short deduction");
  assert.ok(statuses.includes("paid"), "and the rest paid");
  const older = await tenantTx(app, T, (tx) => cycleReport(tx, T, "2026-07", "2026-07-31"));
  assert.ok(older.lines.every((l) => l.status === "paid" || l.status === "suspended"), "earlier months are fully deducted");
});

test("only the deliberate problems show as behind, not every loan waiting for this month's payroll", async () => {
  const arrears = await tenantTx(app, T, (tx) => arrearsByLoan(tx, T, "2026-10-14"));
  const behind = [...arrears.values()].filter((v) => v > 0.5).length;
  assert.equal(behind, 2, "last month's missed and short deductions, nothing else");
});

test("nobody is ever emailed, and the practice approvers cannot be signed in as", async () => {
  assert.equal((await admin`SELECT 1 FROM email_outbox WHERE tenant_id = ${T} AND to_email NOT LIKE 'owner@%'`).length, 0, "only the administrator's invitation is queued");
  const users = await admin`SELECT email, password_hash FROM users WHERE email LIKE ${"practice.%@" + SLUG + ".invalid"} ORDER BY email`;
  assert.deepEqual(users.map((u) => u.email), ["practice.ceo@pd-trial.invalid", "practice.cfo@pd-trial.invalid", "practice.coo@pd-trial.invalid", "practice.dept_head@pd-trial.invalid", "practice.hr@pd-trial.invalid"]);
  for (const u of users) { assert.equal(u.password_hash, "!"); assert.equal(await verifyPassword(u.password_hash, "!"), false); assert.equal(await verifyPassword(u.password_hash, ""), false); }
});

test("real people stay untouched: no employee is linked to a login, and the unfit are never borrowers", async () => {
  assert.equal((await admin`SELECT 1 FROM employees WHERE tenant_id = ${T} AND user_id IS NOT NULL`).length, 0);
  const borrowers = await admin`SELECT DISTINCT e.employee_no FROM loan_applications la JOIN employees e ON e.id = la.employee_id WHERE la.tenant_id = ${T}`;
  const nos = borrowers.map((b) => b.employee_no);
  assert.ok(!nos.includes("PROB1") && !nos.includes("SUSP1"), "not someone on probation, not someone suspended");
  assert.equal(nos.length, 14, "every borrower is a different person");
  assert.equal((await admin`SELECT 1 FROM invitations WHERE tenant_id = ${T}`).length, 1, "only the administrator's invitation exists: nobody else was invited");
});

test("it records itself, and refuses to run twice", async () => {
  const [t] = await admin`SELECT settings FROM tenants WHERE id = ${T}`;
  assert.ok(t.settings.practiceDataLoadedAt && t.settings.trial === true);
  assert.equal((await admin`SELECT 1 FROM audit_log WHERE tenant_id = ${T} AND action = 'practice_data.loaded'`).length, 1);
  await assert.rejects(loadPracticeBook(app, T, { today: TODAY }), /already has loans or applications/);
  await assert.rejects(loadPayrollHistory(app, T, { today: TODAY }), /already has payroll history/);
});

test("a real (non-trial) organisation is refused, whatever the caller says", async () => {
  await admin.unsafe(tenantSql({ ...input, slug: "pd-real", trial: false, token: "d".repeat(64) }).sql);
  const [{ id }] = await admin`SELECT id FROM tenants WHERE slug = 'pd-real'`;
  await staff(id, 12);
  await assert.rejects(loadPracticeBook(app, id, { today: TODAY }), /only be loaded into an organisation flagged as a trial/);
  await assert.rejects(loadPayrollHistory(app, id, { today: TODAY }), /flagged as a trial/);
  assert.equal((await admin`SELECT 1 FROM loans WHERE tenant_id = ${id}`).length, 0, "nothing was written");
});

test("a trial with too few eligible people is refused with a clear reason, and writes nothing", async () => {
  await admin.unsafe(tenantSql({ ...input, slug: "pd-small", token: "e".repeat(64) }).sql);
  const [{ id }] = await admin`SELECT id FROM tenants WHERE slug = 'pd-small'`;
  await admin`INSERT INTO employees (tenant_id,employee_no,full_name,gross_salary,net_salary,is_post_probation) VALUES (${id},'X1','Only One',3000000,2400000,true)`;
  await assert.rejects(loadPracticeBook(app, id, { today: TODAY }), /Only 1 people are eligible.*at least 6/);
  assert.equal((await admin`SELECT 1 FROM users WHERE email = 'practice.hr@pd-small.invalid'`).length, 0, "not even the practice accounts were created (all or nothing)");
});
