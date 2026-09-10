// scripts/seed-mua-history.mjs — 3 months of realistic MUA demo history.
//
// Active/settled loans + disbursements are direct inserts (same pattern as
// seed-demo.mjs) since they represent ALREADY-decided history — nothing to
// re-approve. Repayments use the REAL recordRepayment() so the ledger,
// arrears, and interest-collected figures are genuinely derived, not faked.
// The in-flight applications are driven through the REAL decide() engine
// path (same pattern as advance-demo-app.mjs) using the 6 real accounts
// from seed-mua-accounts.mjs, so the approval audit trail has real entries.
//
// Usage: node --import tsx --import dotenv/config scripts/seed-mua-history.mjs
import postgres from "postgres";
import { generateSchedule } from "@wola/engine";
import { tenantTx, decide, recordRepayment, audit } from "@wola/db";
import "dotenv/config";

const admin = postgres(process.env.DATABASE_ADMIN_URL, { max: 1 });
const app = postgres(process.env.DATABASE_URL, { max: 2 });

const [t] = await admin`SELECT id FROM tenants WHERE slug = 'mua'`;
if (!t) { console.error("mua tenant not found"); process.exit(1); }
const T = t.id;

const emp = async (no) => (await admin`SELECT id, full_name, gross_salary, net_salary, user_id FROM employees WHERE tenant_id = ${T} AND employee_no = ${no}`)[0];
const prod = async (kind) => (await admin`SELECT id, interest_applies FROM loan_products WHERE tenant_id = ${T} AND kind = ${kind}`)[0];
const actorFor = async (email, role) => {
  const [u] = await admin`SELECT id FROM users WHERE email = ${email}`;
  const [e] = await admin`SELECT id FROM employees WHERE tenant_id = ${T} AND user_id = ${u.id}`;
  return { userId: u.id, employeeId: e.id, role };
};

// ---- rate index (needed before decide() can finalize any interest-bearing
// product — see the "no rate index configured" guard in resolveRate). ------
const [rate] = await admin`
  INSERT INTO rate_indices (tenant_id, name, current_value)
  VALUES (${T}, 'CBR', 9.5)
  ON CONFLICT (tenant_id, name, effective_from) DO UPDATE SET current_value = EXCLUDED.current_value
  RETURNING id`;
await admin`UPDATE loan_products SET rate_index_id = ${rate.id} WHERE tenant_id = ${T} AND kind IN ('term','asset')`;
console.log("rate index CBR=9.5% linked to interest-bearing products");

// ---- clean prior run (idempotent, marked via purpose) ----------------------
await admin`DELETE FROM loan_applications WHERE tenant_id = ${T} AND purpose LIKE '[mua-demo]%'`;
console.log("cleared prior demo rows");

// ---- helper: a fully historical, already-approved+disbursed loan ----------
async function makeActiveLoan(employeeNo, kind, amount, tenor, startDate) {
  const e = await emp(employeeNo);
  const p = await prod(kind);
  const RATE = 0.095;
  const rate = p.interest_applies ? RATE : 0;

  const [appn] = await admin`
    INSERT INTO loan_applications (tenant_id, employee_id, loan_product_id, amount, tenor_months, status, purpose)
    VALUES (${T}, ${e.id}, ${p.id}, ${amount}, ${tenor}, 'approved', ${"[mua-demo] " + kind + " for " + e.full_name})
    RETURNING id`;

  const [loan] = await admin`
    INSERT INTO loans (tenant_id, application_id, principal, annual_rate, rate_mode, start_date, tenor_months, status)
    VALUES (${T}, ${appn.id}, ${amount}, ${rate * 100}, ${p.interest_applies ? "index_plus_margin" : "fixed"}, ${startDate}, ${tenor}, 'active')
    RETURNING id`;

  await admin`
    INSERT INTO disbursements (tenant_id, loan_id, method, amount, reference, disbursed_at)
    VALUES (${T}, ${loan.id}, 'to_employee', ${amount}, '[mua-demo] seed', ${startDate})`;

  const schedule = generateSchedule({
    principal: amount, annualRate: rate, tenorMonths: tenor,
    paymentsPerYear: 12, startDate: new Date(startDate), decimals: 0,
  });
  const [sched] = await admin`
    INSERT INTO loan_schedules (tenant_id, loan_id, version, engine_version, is_active)
    VALUES (${T}, ${loan.id}, 1, 'demo-seed', true) RETURNING id`;
  for (const line of schedule.lines) {
    await admin`
      INSERT INTO schedule_lines (tenant_id, schedule_id, period_no, due_date, opening_balance, principal_due, interest_due, instalment, closing_balance)
      VALUES (${T}, ${sched.id}, ${line.period}, ${line.dueDate}, ${line.openingBalance}, ${line.principal}, ${line.interest}, ${line.instalment}, ${line.closingBalance})`;
  }
  console.log(`loan: ${kind} ${amount.toLocaleString()} for ${e.full_name} (${schedule.lines.length}-line schedule)`);
  return { loanId: loan.id, employeeName: e.full_name };
}

/** Pay the first N due (due_date <= today) schedule lines via the REAL
 *  ledger function — genuine interest/principal split, genuine outstanding. */
async function payFirstNDue(loanId, n, source = "payroll") {
  const lines = await admin`
    SELECT sl.instalment FROM schedule_lines sl
    JOIN loan_schedules s ON s.id = sl.schedule_id
    WHERE s.loan_id = ${loanId} AND s.is_active AND sl.due_date <= CURRENT_DATE
    ORDER BY sl.period_no ASC LIMIT ${n}`;
  for (const line of lines) {
    const res = await recordRepayment(admin, { tenantId: T, loanId, amount: Number(line.instalment), source });
    if (res.settled) console.log(`  -> loan ${loanId} SETTLED`);
  }
  return lines.length;
}

// ---- 1-5: active loans with real repayment history -------------------------
const l1 = await makeActiveLoan("MUA026", "term", 15_000_000, 24, "2026-05-01");   // Sheila Katushabe — healthy
await payFirstNDue(l1.loanId, 2);

const l2 = await makeActiveLoan("MUA005", "asset", 40_000_000, 36, "2026-03-01"); // Leuben Sajjabi — deliberately behind (arrears demo)
await payFirstNDue(l2.loanId, 2);

const l3 = await makeActiveLoan("MUA020", "advance", 2_000_000, 2, "2026-06-01"); // Albert Sajjabi — fully settled
await payFirstNDue(l3.loanId, 2);

const l4 = await makeActiveLoan("MUA063", "term", 12_000_000, 18, "2026-04-15"); // Proscovia Aituk — healthy
await payFirstNDue(l4.loanId, 3);

const l5 = await makeActiveLoan("MUA055", "advance", 1_500_000, 3, "2026-06-15"); // Genevieve Namukwaya — one payment in
await payFirstNDue(l5.loanId, 1);

// ---- 6: approved but not yet disbursed (live demo: CFO disburses) ---------
{
  const e = await emp("MUA079"); // Amos Mwebaze
  const p = await prod("advance");
  const [appn] = await admin`
    INSERT INTO loan_applications (tenant_id, employee_id, loan_product_id, amount, tenor_months, status, purpose)
    VALUES (${T}, ${e.id}, ${p.id}, 1000000, 2, 'approved', '[mua-demo] advance for Amos Mwebaze')
    RETURNING id`;
  await admin`
    INSERT INTO loans (tenant_id, application_id, principal, annual_rate, rate_mode, start_date, tenor_months, status)
    VALUES (${T}, ${appn.id}, 1000000, 0, 'fixed', CURRENT_DATE, 2, 'pending_disbursement')`;
  console.log("loan: awaiting disbursement for Amos Mwebaze");
}

// ---- 7-8: pending applications sitting at the first (dept_head) stage -----
// No actor needed to exist at this stage — it's just the current position.
async function makeSubmitted(employeeNo, kind, amount, tenor) {
  const e = await emp(employeeNo);
  const p = await prod(kind);
  await admin`
    INSERT INTO loan_applications (tenant_id, employee_id, loan_product_id, amount, tenor_months, status, purpose)
    VALUES (${T}, ${e.id}, ${p.id}, ${amount}, ${tenor}, 'submitted', ${"[mua-demo] " + kind + " for " + e.full_name})`;
  console.log(`application: submitted, ${kind} ${amount.toLocaleString()} for ${e.full_name}`);
}
await makeSubmitted("MUA061", "advance", 1_200_000, 2); // Bridgette Nampijja
await makeSubmitted("MUA023", "term", 6_000_000, 18);   // Isaac Kiyingi

// ---- 9-12: driven through the REAL decide() engine, using real accounts --
const dragu = await actorFor("adragu@mua.co.ug", "dept_head");
const zaake = await actorFor("mzaake@mua.co.ug", "dept_head");
const hr = await actorFor("essematimba@mua.co.ug", "hr");
const cfo = await actorFor("rntege@mua.co.ug", "cfo");
const ceo = await actorFor("nlutakome@mua.co.ug", "ceo");

async function submitApp(employeeNo, kind, amount, tenor) {
  const e = await emp(employeeNo);
  const p = await prod(kind);
  const [appn] = await admin`
    INSERT INTO loan_applications (tenant_id, employee_id, loan_product_id, amount, tenor_months, status, purpose)
    VALUES (${T}, ${e.id}, ${p.id}, ${amount}, ${tenor}, 'submitted', ${"[mua-demo] " + kind + " for " + e.full_name})
    RETURNING id`;
  return appn.id;
}
const approveAs = (actor, applicationId, startDate) =>
  tenantTx(app, T, (tx) => decide(tx, { tenantId: T, applicationId, actor, decision: "approved", startDate }));
const rejectAs = (actor, applicationId, comment) =>
  tenantTx(app, T, (tx) => decide(tx, { tenantId: T, applicationId, actor, decision: "rejected", comment }));

// 9: Hamza Kintu (reports to Dragu) — Car Loan, driven to dept_head+hr done,
// sits at CFO — a live "awaiting you" for the CFO's dashboard tomorrow.
{
  const id = await submitApp("MUA057", "asset", 25_000_000, 36);
  let r = await approveAs(dragu, id);
  console.log("Hamza Kintu car loan — dept_head:", r.ok ? r.routing.state : r.error);
  r = await approveAs(hr, id);
  console.log("Hamza Kintu car loan — hr:", r.ok ? r.routing.state : r.error, "(now at CFO)");
}

// 10: Brian Nitusiima (reports to Dragu) — Advance, sits at HR.
{
  const id = await submitApp("MUA074", "advance", 1_000_000, 2);
  const r = await approveAs(dragu, id);
  console.log("Brian Nitusiima advance — dept_head:", r.ok ? r.routing.state : r.error, "(now at HR)");
}

// 11: Vanessa Nakibombo (reports to Dragu) — Development Loan, driven ALL the
// way to full approval -> creates a pending_disbursement loan.
{
  const id = await submitApp("MUA068", "term", 6_000_000, 24);
  let r = await approveAs(dragu, id);
  r = await approveAs(hr, id);
  r = await approveAs(cfo, id);
  r = await approveAs(ceo, id, new Date());
  console.log("Vanessa Nakibombo development loan — fully approved:", r.ok ? r.routing.state : r.error, r.loanId ? `(loan ${r.loanId})` : "");
}

// 12: Sheila Katushabe (reports to Zaake) — a SECOND application (advance;
// she already has an active term loan, no exclusion conflict), rejected at
// dept_head — populates the rejection stats + audit trail.
{
  const id = await submitApp("MUA026", "advance", 1_500_000, 3);
  const r = await rejectAs(zaake, id, "Already carrying a Development Loan instalment this quarter — revisit next cycle.");
  console.log("Sheila Katushabe advance — rejected:", r.ok ? r.routing.state : r.error);
}

console.log("\nMUA demo history seeded.");
await app.end();
await admin.end();
