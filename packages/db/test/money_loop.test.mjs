// The money loop: one definition of outstanding, the payroll cycle (expected vs
// received), the bulk run and the actuals import (both tie out), payment holidays
// as events, early repayment, and tenant isolation on every new table.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { persistSchedule } from "../src/schedules.ts";
import { recordRepayment, loanOutstanding, repaymentPosition } from "../src/loans.ts";
import {
  arrearsByLoan, cycleReport, expectedCsv, parseActualsCsv, previewActuals, postActuals, postBulkRun, csvField,
} from "../src/payroll.ts";
import { suspendLoan, cancelSuspension, listSuspensions } from "../src/suspensions.ts";
import {
  requestEarlyRepayment, recordEarlyRepayment, declineEarlyRepayment, cancelEarlyRepayment, listEarlyRepaymentRequests,
  openExitRepaymentRequests,
} from "../src/early-repayment.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
let admin, app, T, T2;
const loans = {};   // name -> { id, employeeId, userId }
const emps = {};
const TODAY = "2026-04-20";           // every cycle used below has closed
const OPEN_TODAY = "2026-03-10";      // 2026-03 is still open on this date

const inTenant = (tid, fn) => app.begin(async (tx) => { await tx`SELECT set_config('app.tenant_id', ${tid}, true)`; return fn(tx); });
const T1 = (fn) => inTenant(T, fn);

async function makeLoan(name, empNo, principal = 6_000_000, tenor = 6, rate = 0.12) {
  if (!emps[empNo]) {
    const [u] = await admin`INSERT INTO users (email,name,status,password_hash) VALUES (${empNo.toLowerCase() + "@loop.t"},${empNo},'active','x') RETURNING id`;
    await admin`INSERT INTO memberships (tenant_id,user_id,role) VALUES (${T},${u.id},'employee')`;
    const [e] = await admin`INSERT INTO employees (tenant_id,user_id,employee_no,full_name,department,gross_salary,net_salary)
      VALUES (${T},${u.id},${empNo},${"Person " + empNo},'Ops',5000000,3500000) RETURNING id`;
    emps[empNo] = { id: e.id, userId: u.id };
  }
  const [prod] = await admin`SELECT id FROM loan_products WHERE tenant_id = ${T} LIMIT 1`;
  const [a] = await admin`INSERT INTO loan_applications (tenant_id,employee_id,loan_product_id,amount,tenor_months,status)
    VALUES (${T},${emps[empNo].id},${prod.id},${principal},${tenor},'approved') RETURNING id`;
  const [l] = await admin`INSERT INTO loans (tenant_id,application_id,principal,annual_rate,rate_mode,start_date,tenor_months,status)
    VALUES (${T},${a.id},${principal},${rate},'fixed','2026-01-15',${tenor},'active') RETURNING id`;
  await T1((tx) => persistSchedule(tx, { tenantId: T, loanId: l.id, principal, annualRate: rate, tenorMonths: tenor, startDate: new Date(2026, 0, 15), decimals: 0 }));
  loans[name] = { id: l.id, empNo };
  return l.id;
}

const instalmentOf = async (loanId) => Number((await admin`
  SELECT sl.instalment FROM schedule_lines sl JOIN loan_schedules s ON s.id = sl.schedule_id
  WHERE s.loan_id = ${loanId} AND s.is_active ORDER BY sl.period_no LIMIT 1`)[0].instalment);
const pay = (name, amount, date, source = "payroll") =>
  T1((tx) => recordRepayment(tx, { tenantId: T, loanId: loans[name].id, amount, source, valueDate: new Date(date) }));
const line = (rep, name) => rep.lines.find((l) => l.loanId === loans[name].id);

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 3 });
  await admin`DELETE FROM tenants WHERE slug IN ('loop-t','loop-t2')`;
  await admin`DELETE FROM users WHERE email LIKE '%@loop.t'`;
  [{ id: T }] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('loop-t','Loop','active') RETURNING id`;
  [{ id: T2 }] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('loop-t2','Loop2','active') RETURNING id`;
  await admin`INSERT INTO loan_products (tenant_id,name,kind) VALUES (${T},'Dev','term')`;

  await makeLoan("paid", "E1");
  await makeLoan("missed", "E2");
  await makeLoan("short", "E3");
  await makeLoan("over", "E4");
  await makeLoan("held", "E5");
  await makeLoan("second", "E1", 3_000_000, 6);   // E1 has TWO loans: import needs a loan_ref
});
after(async () => { await app.end(); await admin.end(); });

// ----------------------------------------------------- 1. one outstanding

test("loan_balances (the one definition) agrees with loanOutstanding for every loan, before and after repayments", async () => {
  const check = async () => {
    for (const { id } of Object.values(loans)) {
      const v = (await T1((tx) => tx`SELECT principal, principal_repaid, outstanding FROM loan_balances WHERE loan_id = ${id}`))[0];
      const o = await T1((tx) => loanOutstanding(tx, T, id));
      assert.equal(Number(v.outstanding), o.outstanding);
      assert.equal(Number(v.principal_repaid), o.principalRepaid);
    }
  };
  await check();
  const inst = await instalmentOf(loans.paid.id);
  await pay("paid", inst, "2026-02-25");
  await pay("short", Math.round((await instalmentOf(loans.short.id)) / 2), "2026-02-25");
  await check();
});

test("no source file computes outstanding from repayments itself: they all read loan_balances", () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const hits = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      if (e === "node_modules" || e === ".next" || e === "dist" || e === "__tests__" || e === "test") continue;
      const p = path.join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      // payroll.ts measures the ledger AS OF a date (a cycle's start), which the
      // current-balance view cannot give; it is the one legitimate dated copy.
      else if (e !== "payroll.ts" && /\.(ts|tsx)$/.test(e) && readFileSync(p, "utf8").includes("allocation->>'principal'")) hits.push(path.relative(root, p));
    }
  };
  walk(path.join(root, "apps/web/src"));
  walk(path.join(root, "packages/db/src"));
  assert.deepEqual(hits, [], `inline copies of the outstanding formula found: ${hits.join(", ")}`);
});

// ------------------------------------------------------- 2. payroll cycle

test("cycle report: each loan lands in the right status, and expected is what the ledger needs", async () => {
  // Cycle 2026-02: first instalment of every loan falls due on the 15th.
  await pay("over", Math.round((await instalmentOf(loans.over.id)) * 1.2), "2026-02-26");
  await pay("second", await instalmentOf(loans.second.id), "2026-02-26");
  // E2 pays nothing. E5 is on a payment holiday for February (suspended below).
  const s = await T1((tx) => suspendLoan(tx, { tenantId: T, loanId: loans.held.id, fromMonth: "2026-02", months: 1, reason: "Medical leave", actorId: null }));
  assert.equal(s.ok, true, s.error);

  const r = await T1((tx) => cycleReport(tx, T, "2026-02", TODAY));
  assert.equal(r.open, false);
  assert.equal(line(r, "paid").status, "paid");
  assert.equal(line(r, "missed").status, "missed");
  assert.equal(line(r, "short").status, "short");
  assert.equal(line(r, "over").status, "over");
  assert.equal(line(r, "held").status, "suspended");
  assert.equal(line(r, "held").expected, 0);

  const inst = await instalmentOf(loans.missed.id);
  assert.equal(line(r, "missed").expected, inst, "an unpaid first instalment is expected in full");
  assert.equal(line(r, "missed").remaining, inst);
  assert.equal(r.totals.counts.missed, 1);
  assert.equal(r.totals.counts.short, 1);
  assert.equal(r.totals.counts.suspended, 1);
  assert.equal(Math.round(r.totals.expected * 100), Math.round(r.lines.reduce((s, l) => s + l.expected, 0) * 100));
});

test("arrears carry forward: a missed instalment is expected again next cycle, on top of the new one", async () => {
  const r = await T1((tx) => cycleReport(tx, T, "2026-03", TODAY));
  const m = line(r, "missed");
  const inst = await instalmentOf(loans.missed.id);
  assert.ok(Math.abs(m.arrearsBroughtForward - inst) <= 1, `arrears ${m.arrearsBroughtForward} should be one instalment ${inst}`);
  assert.ok(m.expected > inst * 1.9, "two instalments' worth is now due");
  assert.ok(Math.abs(m.scheduledInCycle - inst) <= 1);
  // The loan that paid in full has no arrears.
  assert.equal(line(r, "paid").arrearsBroughtForward, 0);
});

test("an open cycle says 'awaiting', never 'missed' (payroll hasn't run yet)", async () => {
  const r = await T1((tx) => cycleReport(tx, T, "2026-03", OPEN_TODAY));
  assert.equal(r.open, true);
  assert.equal(line(r, "missed").status, "awaiting");
});

test("the expected-deductions CSV lists exactly what payroll should take, safely", async () => {
  const r = await T1((tx) => cycleReport(tx, T, "2026-02", TODAY));
  const csv = expectedCsv(r);
  const rows = csv.trim().split("\r\n");
  assert.equal(rows[0], "cycle,employee_no,employee_name,department,product,loan_ref,expected_deduction,arrears_included,scheduled_this_cycle");
  assert.ok(!csv.includes(loans.held.id.slice(0, 8).toUpperCase()), "a loan on holiday is left out");
  const mine = rows.find((x) => x.includes(`LN-${loans.missed.id.slice(0, 8).toUpperCase()}`));
  assert.ok(mine && mine.startsWith("2026-02,E2,Person E2,Ops,Dev,"));
  assert.equal(csvField("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"", "formula-looking text is neutralised");
  assert.equal(csvField("Doe, Jane"), "\"Doe, Jane\"");
  assert.equal(csvField(-5), "-5", "real negative numbers are untouched");
});

// ----------------------------------------------------- 3. actuals import

test("import preview classifies every row and finds the loans missing from the file", async () => {
  const instMissed = await instalmentOf(loans.missed.id);
  const r = await T1((tx) => cycleReport(tx, T, "2026-02", TODAY));
  const shortLine = line(r, "short");
  const refSecond = `LN-${loans.second.id.slice(0, 8).toUpperCase()}`;
  const csv = [
    "employee_no,amount,loan_ref",
    `E2,${instMissed},`,              // exact
    `E3,${Math.round(shortLine.remaining / 2)},`, // short against what is still owed
    "E9,1000,",                        // unknown employee
    `E1,500,`,                         // E1 has two loans, no loan_ref -> ambiguous (second is already paid; paid has remaining 0 too)
    `E2,${instMissed},`,              // duplicate of the first E2 row
    "E4,abc,",                         // bad amount
  ].join("\n");
  const pv = await T1((tx) => previewActuals(tx, T, "2026-02", csv, TODAY));
  const by = (n) => pv.rows.find((x) => x.row.employeeNo === n);
  assert.equal(pv.rows.filter((x) => x.row.employeeNo === "E2")[0].status, "exact");
  assert.equal(pv.rows.filter((x) => x.row.employeeNo === "E2")[1].status, "duplicate");
  assert.equal(by("E3").status, "short");
  assert.equal(by("E9").status, "unmatched");
  assert.equal(by("E1").status, "ambiguous", "two loans for one employee need a loan_ref");
  assert.match(by("E1").message, /loan_ref/);
  assert.equal(pv.parseErrors.length, 1);
  assert.match(pv.parseErrors[0].message, /isn't an amount/);
  assert.equal(pv.totals.postable, 2);
  assert.ok(!pv.missing.some((l) => l.employeeNo === "E2"), "E2 is in the file, so isn't reported missing");
  assert.ok(refSecond.startsWith("LN-"));
});

test("posting the import records only valid rows, ties out to its run, and a second post records nothing", async () => {
  const instMissed = await instalmentOf(loans.missed.id);
  const csv = ["employee_no,amount", `E2,${instMissed}`, "E9,1000"].join("\n");
  const before = await T1((tx) => loanOutstanding(tx, T, loans.missed.id));
  const res = await T1((tx) => postActuals(tx, { tenantId: T, cycle: "2026-02", csv, actorId: null, fileName: "feb.csv", today: TODAY }));
  assert.equal(res.posted, 1);
  assert.equal(res.postedTotal, instMissed);
  assert.equal(res.skipped.length, 1, "the unknown employee is reported, not silently dropped");

  // Tie-out: the run's total IS the sum of its repayments.
  const [run] = await admin`SELECT posted_total, loan_count, kind FROM payroll_runs WHERE id = ${res.runId}`;
  const [tie] = await admin`SELECT sum(amount) AS s, count(*)::int AS n FROM repayments WHERE payroll_run_id = ${res.runId}`;
  assert.equal(Number(run.posted_total), Number(tie.s));
  assert.equal(run.loan_count, tie.n);
  assert.equal(run.kind, "import");

  const after = await T1((tx) => loanOutstanding(tx, T, loans.missed.id));
  assert.ok(after.outstanding < before.outstanding);

  // Same file again: that loan is now fully received for the cycle, so nothing more is recorded.
  const again = await T1((tx) => postActuals(tx, { tenantId: T, cycle: "2026-02", csv, actorId: null, today: TODAY }));
  assert.equal(again.posted, 0);
  assert.equal(again.runId, null);
});

test("an amount larger than the whole payoff is refused, not recorded", async () => {
  const csv = ["employee_no,amount", "E4,999999999"].join("\n");
  const pv = await T1((tx) => previewActuals(tx, T, "2026-02", csv, TODAY));
  assert.ok(["too_much", "already_paid"].includes(pv.rows[0].status), `got ${pv.rows[0].status}`);
  assert.equal(pv.rows[0].postable, false);
});

// --------------------------------------------------------------- 4. bulk run

test("bulk run: one action records every due deduction and the totals tie out; running it again records nothing", async () => {
  const before = await T1((tx) => cycleReport(tx, T, "2026-03", TODAY));
  const due = before.lines.filter((l) => l.status !== "suspended" && l.remaining > 0.5);
  assert.ok(due.length >= 3);
  const expectedSum = Math.round(due.reduce((s, l) => s + l.remaining, 0) * 100) / 100;

  const run = await T1((tx) => postBulkRun(tx, { tenantId: T, cycle: "2026-03", actorId: null, today: TODAY }));
  assert.equal(run.posted, due.length);
  assert.equal(run.postedTotal, expectedSum);

  const [row] = await admin`SELECT posted_total, loan_count FROM payroll_runs WHERE id = ${run.runId}`;
  const [tie] = await admin`SELECT sum(amount) AS s, count(*)::int AS n FROM repayments WHERE payroll_run_id = ${run.runId}`;
  assert.equal(Number(row.posted_total), Number(tie.s), "run total equals the ledger entries it wrote");
  assert.equal(row.loan_count, tie.n);

  const after = await T1((tx) => cycleReport(tx, T, "2026-03", TODAY));
  assert.ok(after.lines.every((l) => ["paid", "over", "suspended"].includes(l.status)), "every due loan is now paid");
  assert.equal(after.totals.shortfall, 0);

  const again = await T1((tx) => postBulkRun(tx, { tenantId: T, cycle: "2026-03", actorId: null, today: TODAY }));
  assert.equal(again.posted, 0);
  assert.equal(again.runId, null);
});

// ------------------------------------------------------ 5. payment holidays

test("a payment holiday is an event: no schedule rows are added, changed or replaced", async () => {
  const before = await admin`
    SELECT (SELECT count(*)::int FROM schedule_lines WHERE tenant_id = ${T}) AS lines,
           (SELECT count(*)::int FROM loan_schedules WHERE tenant_id = ${T}) AS versions,
           (SELECT sum(instalment) FROM schedule_lines WHERE tenant_id = ${T}) AS total`;
  const r = await T1((tx) => suspendLoan(tx, { tenantId: T, loanId: loans.paid.id, fromMonth: "2026-05", months: 2, reason: "Unpaid leave", actorId: null }));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.to, "2026-06-30");
  const after = await admin`
    SELECT (SELECT count(*)::int FROM schedule_lines WHERE tenant_id = ${T}) AS lines,
           (SELECT count(*)::int FROM loan_schedules WHERE tenant_id = ${T}) AS versions,
           (SELECT sum(instalment) FROM schedule_lines WHERE tenant_id = ${T}) AS total`;
  assert.deepEqual(after[0], before[0]);

  // May and June report 'suspended'; the instalments move to July onward.
  // (Arrears from before the holiday are still owed, so the line is not "suspended"
  // while it carries them; what must hold is that no instalment falls in the holiday.)
  const may = await T1((tx) => cycleReport(tx, T, "2026-05", "2026-08-01"));
  assert.equal(line(may, "paid").suspended, true);
  assert.equal(line(may, "paid").scheduledInCycle, 0, "nothing falls due inside the holiday");
  const july = await T1((tx) => cycleReport(tx, T, "2026-07", "2026-08-01"));
  assert.ok(line(july, "paid").expected > 0, "the deferred instalment is expected after the holiday");
});

test("holidays are validated: needs a reason, no overlap, only running loans; a mistaken one can be cancelled", async () => {
  const none = await T1((tx) => suspendLoan(tx, { tenantId: T, loanId: loans.paid.id, fromMonth: "2026-05", months: 1, reason: "  ", actorId: null }));
  assert.equal(none.ok, false);
  const overlap = await T1((tx) => suspendLoan(tx, { tenantId: T, loanId: loans.paid.id, fromMonth: "2026-06", months: 1, reason: "x", actorId: null }));
  assert.equal(overlap.ok, false);
  assert.match(overlap.error, /already paused/);
  const list = await T1((tx) => listSuspensions(tx, T, loans.paid.id));
  assert.equal(list.length, 1);
  const c = await T1((tx) => cancelSuspension(tx, { tenantId: T, suspensionId: list[0].id, actorId: null }));
  assert.equal(c.ok, true);
  const june = await T1((tx) => cycleReport(tx, T, "2026-06", "2026-08-01"));
  assert.notEqual(line(june, "paid")?.status, "suspended", "cancelled: the holiday no longer applies");
});

// -------------------------------------------------------- 6. early repayment

test("early repayment: a lump sum shortens the schedule, then paying off in full settles the loan at zero", async () => {
  const L = loans.second;
  const user = emps.E1.userId;
  const other = emps.E2.userId;

  // Only the borrower may ask.
  const wrong = await T1((tx) => requestEarlyRepayment(tx, { tenantId: T, loanId: L.id, requestedBy: other, kind: "full" }));
  assert.equal(wrong.ok, false);

  const pos = await T1((tx) => repaymentPosition(tx, T, L.id));
  const lump = Math.round(pos.outstanding * 0.75); // several instalments' worth, so whole instalments drop away
  const q = await T1((tx) => requestEarlyRepayment(tx, { tenantId: T, loanId: L.id, requestedBy: user, kind: "partial", amount: lump, reason: "Bonus" }));
  assert.equal(q.ok, true, q.error);
  const dup = await T1((tx) => requestEarlyRepayment(tx, { tenantId: T, loanId: L.id, requestedBy: user, kind: "full" }));
  assert.equal(dup.ok, false, "one open request per loan");

  const [{ n: linesBefore }] = await admin`SELECT count(*)::int AS n FROM schedule_lines sl JOIN loan_schedules s ON s.id = sl.schedule_id WHERE s.loan_id = ${L.id} AND s.is_active AND sl.closing_balance > 0`;
  const rec = await T1((tx) => recordEarlyRepayment(tx, { tenantId: T, requestId: q.id, actorId: user }));
  assert.equal(rec.ok, true, rec.error);
  assert.equal(rec.reamortized, true, "a lump sum re-amortizes the remaining schedule");
  assert.equal(rec.settled, false);
  const [{ n: linesAfter }] = await admin`SELECT count(*)::int AS n FROM schedule_lines sl JOIN loan_schedules s ON s.id = sl.schedule_id WHERE s.loan_id = ${L.id} AND s.is_active AND sl.closing_balance > 0`;
  assert.ok(linesAfter < linesBefore, `the loan now finishes sooner (${linesAfter} instalments left, was ${linesBefore})`);

  const q2 = await T1((tx) => requestEarlyRepayment(tx, { tenantId: T, loanId: L.id, requestedBy: user, kind: "full" }));
  assert.equal(q2.ok, true, q2.error);
  const done = await T1((tx) => recordEarlyRepayment(tx, { tenantId: T, requestId: q2.id, actorId: user }));
  assert.equal(done.ok, true, done.error);
  assert.equal(done.settled, true);
  assert.equal(done.outstanding, 0, "balance reaches zero");
  const [loan] = await admin`SELECT status FROM loans WHERE id = ${L.id}`;
  assert.equal(loan.status, "settled");
  const reqs = await T1((tx) => listEarlyRepaymentRequests(tx, T, { loanId: L.id }));
  assert.deepEqual(reqs.map((r) => r.status).sort(), ["paid", "paid"]);
  // A settled loan can't be asked about again.
  const again = await T1((tx) => requestEarlyRepayment(tx, { tenantId: T, loanId: L.id, requestedBy: user, kind: "full" }));
  assert.equal(again.ok, false);
});

test("a request can be declined (with a reason) or withdrawn by the person who made it", async () => {
  const L = loans.over;
  const user = emps.E4.userId;
  const q = await T1((tx) => requestEarlyRepayment(tx, { tenantId: T, loanId: L.id, requestedBy: user, kind: "full" }));
  assert.equal(q.ok, true, q.error);
  const noNote = await T1((tx) => declineEarlyRepayment(tx, { tenantId: T, requestId: q.id, actorId: user, note: " " }));
  assert.equal(noNote.ok, false);
  const stranger = await T1((tx) => cancelEarlyRepayment(tx, { tenantId: T, requestId: q.id, userId: emps.E2.userId }));
  assert.equal(stranger.ok, false);
  const mine = await T1((tx) => cancelEarlyRepayment(tx, { tenantId: T, requestId: q.id, userId: user }));
  assert.equal(mine.ok, true);
  const q2 = await T1((tx) => requestEarlyRepayment(tx, { tenantId: T, loanId: L.id, requestedBy: user, kind: "full" }));
  const dec = await T1((tx) => declineEarlyRepayment(tx, { tenantId: T, requestId: q2.id, actorId: emps.E2.userId, note: "Not before payroll closes" }));
  assert.equal(dec.ok, true);
});

// ------------------------------------------------------- 5b. arrears in reports

test("arrears for reports agree with the payroll screen, and a payment holiday is not arrears", async () => {
  const today = "2026-08-01";
  const plain = await T1((tx) => arrearsByLoan(tx, T, today));
  const aug = await T1((tx) => cycleReport(tx, T, "2026-08", today));
  const short = line(aug, "short");
  assert.equal(plain.get(loans.short.id), short.arrearsBroughtForward, "same rule as the cycle report's arrears brought forward");
  assert.ok(plain.get(loans.paid.id) > 0, "the loan that stopped paying in February is behind");
  const h = await T1((tx) => suspendLoan(tx, { tenantId: T, loanId: loans.paid.id, fromMonth: "2026-03", months: 12, reason: "Sabbatical", actorId: null }));
  assert.equal(h.ok, true, h.error);
  const held = await T1((tx) => arrearsByLoan(tx, T, today));
  assert.equal(held.get(loans.paid.id), 0, "instalments inside a holiday are not late");
  const list = await T1((tx) => listSuspensions(tx, T, loans.paid.id));
  await T1((tx) => cancelSuspension(tx, { tenantId: T, suspensionId: list.find((x) => !x.cancelled).id, actorId: null }));
});

// ------------------------------------------------------- 6b. loan-exit policy

test("when someone leaves, the default policy opens a payoff request for each running loan (nothing is written off)", async () => {
  const L = loans.over;
  const before = (await admin`SELECT status FROM loans WHERE id = ${L.id}`)[0].status;
  const r = await T1((tx) => openExitRepaymentRequests(tx, { tenantId: T, employeeId: emps[L.empNo].id, actorId: emps.E2.userId }));
  assert.equal(r.policy, "recover_balance");
  assert.equal(r.opened, 1);
  const again = await T1((tx) => openExitRepaymentRequests(tx, { tenantId: T, employeeId: emps[L.empNo].id, actorId: emps.E2.userId }));
  assert.equal(again.opened, 0, "an open request is not duplicated");
  const open = await T1((tx) => listEarlyRepaymentRequests(tx, T, { loanId: L.id, status: "requested" }));
  assert.equal(open.length, 1);
  assert.equal(open[0].kind, "full");
  assert.equal((await admin`SELECT status FROM loans WHERE id = ${L.id}`)[0].status, before, "the loan itself is untouched");

  // A tenant that prefers to handle exits by hand opens nothing.
  await T1((tx) => cancelEarlyRepayment(tx, { tenantId: T, requestId: open[0].id, userId: emps.E2.userId }));
  await admin`UPDATE tenants SET settings = settings || '{"loanExit":{"policy":"manual"}}'::jsonb WHERE id = ${T}`;
  const manual = await T1((tx) => openExitRepaymentRequests(tx, { tenantId: T, employeeId: emps[L.empNo].id, actorId: emps.E2.userId }));
  assert.deepEqual([manual.policy, manual.opened], ["manual", 0]);
  await admin`UPDATE tenants SET settings = settings - 'loanExit' WHERE id = ${T}`;
});

// ------------------------------------------------------- 6c. the bell rings for money events

test("money events notify the right people: finance on a request, the borrower on the outcome", async () => {
  const [fin] = await admin`INSERT INTO users (email,name,status,password_hash) VALUES ('fin@loop.t','Fin','active','x') RETURNING id`;
  await admin`INSERT INTO memberships (tenant_id,user_id,role) VALUES (${T},${fin.id},'cfo')`;
  const bell = async (uid, kind) => (await admin`SELECT title, body, href FROM notifications WHERE tenant_id = ${T} AND user_id = ${uid} AND kind = ${kind} ORDER BY created_at`);

  // The pause recorded earlier on E1's loan told E1.
  const paused = await bell(emps.E1.userId, "loan.paused");
  assert.ok(paused.length >= 1, "the borrower was told their payments were paused");
  assert.match(paused[0].body, /Unpaid leave/);
  assert.equal(paused[0].href, `/loans/${loans.paid.id}`);

  const loanId = await makeLoan("ring", "E6");
  const asked = await T1((tx) => requestEarlyRepayment(tx, { tenantId: T, loanId, requestedBy: emps.E6.userId, kind: "full", notifyRoles: ["cfo"] }));
  assert.equal(asked.ok, true, asked.error);
  const toFinance = await bell(fin.id, "early.requested");
  assert.equal(toFinance.length, 1);
  assert.equal(toFinance[0].href, "/payroll");
  assert.equal((await bell(emps.E6.userId, "early.requested")).length, 0, "the requester isn't told about their own request");

  // Declined: the borrower is told why.
  await T1((tx) => declineEarlyRepayment(tx, { tenantId: T, requestId: asked.id, actorId: fin.id, note: "Not before payroll closes" }));
  const declined = await bell(emps.E6.userId, "early.declined");
  assert.equal(declined.length, 1);
  assert.equal(declined[0].body, "Not before payroll closes");

  // Asked again and recorded in full: the loan settles, and both messages arrive.
  const again = await T1((tx) => requestEarlyRepayment(tx, { tenantId: T, loanId, requestedBy: emps.E6.userId, kind: "full", notifyRoles: ["cfo"] }));
  const done = await T1((tx) => recordEarlyRepayment(tx, { tenantId: T, requestId: again.id, actorId: fin.id }));
  assert.equal(done.settled, true);
  assert.equal((await bell(emps.E6.userId, "loan.settled")).length, 1, "told the loan is fully repaid");
  assert.equal((await bell(emps.E6.userId, "early.recorded")).length, 1);
  // Someone who isn't involved heard nothing about E6's loan.
  assert.equal((await bell(emps.E2.userId, "early.recorded")).length, 0);
});

// ------------------------------------------------ 7. isolation + append-only

test("every new table is tenant-isolated: another organisation sees none of these rows", async () => {
  for (const t of ["payroll_runs", "loan_suspensions", "early_repayment_requests"]) {
    const mine = (await T1((tx) => tx.unsafe(`SELECT count(*)::int AS n FROM ${t}`)))[0].n;
    assert.ok(mine > 0, `${t}: fixture should have rows in the owning tenant`);
    const theirs = (await inTenant(T2, (tx) => tx.unsafe(`SELECT count(*)::int AS n FROM ${t}`)))[0].n;
    assert.equal(theirs, 0, `${t} leaked across tenants`);
    await assert.rejects(
      inTenant(T2, (tx) => tx.unsafe(`INSERT INTO ${t === "payroll_runs" ? "payroll_runs (tenant_id,cycle,kind,loan_count,expected_total,posted_total)" : t === "loan_suspensions" ? "loan_suspensions (tenant_id,loan_id,from_date,to_date,reason)" : "early_repayment_requests (tenant_id,loan_id,kind,quoted_payoff)"} VALUES ('${T}', ${t === "payroll_runs" ? "'2026-01','bulk',0,0,0" : t === "loan_suspensions" ? `'${loans.paid.id}','2026-01-01','2026-01-31','x'` : `'${loans.paid.id}','full',1`})`)),
      /row-level security|violates/i,
      `${t}: writing another tenant's rows must be refused`,
    );
  }
  // And loan_balances can't be used to peek either.
  const peek = await inTenant(T2, (tx) => tx`SELECT count(*)::int AS n FROM loan_balances`);
  assert.equal(peek[0].n, 0);
});

test("history is append-only for the runtime role", async () => {
  await assert.rejects(T1((tx) => tx`DELETE FROM payroll_runs`), /permission denied/i);
  await assert.rejects(T1((tx) => tx`UPDATE payroll_runs SET posted_total = 0`), /permission denied/i);
  await assert.rejects(T1((tx) => tx`DELETE FROM loan_suspensions`), /permission denied/i);
  await assert.rejects(T1((tx) => tx`DELETE FROM early_repayment_requests`), /permission denied/i);
});

test("bulk run on a past cycle skips a loan settled since, instead of failing the whole run", async () => {
  // Paid off early in April, so February still shows its instalment as missing.
  await makeLoan("early", "E90", 3_000_000, 3, 0);
  await pay("early", 3_000_000, "2026-04-05", "manual");
  const [{ status }] = await admin`SELECT status FROM loans WHERE id = ${loans.early.id}`;
  assert.equal(status, "settled");
  const feb = await T1((tx) => cycleReport(tx, T, "2026-02", TODAY));
  assert.ok(line(feb, "early").remaining > 0.5, "the settled loan still shows a gap in its history");

  const run = await T1((tx) => postBulkRun(tx, { tenantId: T, cycle: "2026-02", actorId: null, today: TODAY }));
  assert.ok(run.skipped.some((s) => s.employeeNo === "E90"), "the settled loan is reported as skipped");
  const [{ n }] = await admin`SELECT count(*)::int AS n FROM repayments WHERE loan_id = ${loans.early.id}`;
  assert.equal(n, 1, "nothing more was recorded against the settled loan");
});
