// scripts/seed-demo.mjs — populates testco with a realistic demo book.
// Applications across pipeline states + approved loans with engine-accurate
// schedules, so every dashboard card and the loan book show real figures.
// Idempotent: clears prior demo rows (marked via purpose) before re-inserting.
//
// Usage:  node --import dotenv/config scripts/seed-demo.mjs
import postgres from "postgres";
import { generateSchedule } from "@wola/engine";
import "dotenv/config";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) { console.error("DATABASE_ADMIN_URL required"); process.exit(1); }
const sql = postgres(url, { max: 1 });

const MARK = "[demo]"; // purpose marker so re-runs can clean up

// ---- resolve tenant, products, employees ----------------------------------
const [tenant] = await sql`SELECT id FROM tenants WHERE slug = 'testco'`;
if (!tenant) { console.error("run seed-dev.sql first"); process.exit(1); }
const T = tenant.id;

const products = await sql`
  SELECT id, kind, interest_applies FROM loan_products WHERE tenant_id = ${T}`;
const prod = (k) => products.find((p) => p.kind === k);

const emps = await sql`
  SELECT id, employee_no, full_name, net_salary FROM employees WHERE tenant_id = ${T}`;
const emp = (no) => emps.find((e) => e.employee_no === no);

const [cbr] = await sql`
  SELECT current_value FROM rate_indices WHERE tenant_id = ${T} AND name = 'CBR' LIMIT 1`;
const RATE = cbr ? Number(cbr.current_value) / 100 : 0.095;

// ---- clean previous demo data ---------------------------------------------
// Delete loans+apps we marked. Cascades handle schedules/lines.
await sql`
  DELETE FROM loan_applications
  WHERE tenant_id = ${T} AND purpose LIKE ${MARK + "%"}`;
console.log("cleared prior demo rows");

// ---- helper: create an application -----------------------------------------
async function makeApp(employeeNo, kind, amount, tenor, status) {
  const e = emp(employeeNo);
  const p = prod(kind);
  if (!e || !p) throw new Error(`missing emp ${employeeNo} or product ${kind}`);
  const [app] = await sql`
    INSERT INTO loan_applications
      (tenant_id, employee_id, loan_product_id, amount, tenor_months, status, purpose)
    VALUES (${T}, ${e.id}, ${p.id}, ${amount}, ${tenor}, ${status},
            ${MARK + " " + kind + " for " + e.full_name})
    RETURNING id`;
  return { appId: app.id, product: p };
}

// ---- helper: approve into a loan + engine schedule -------------------------
// disbursed=true (default) creates an ACTIVE loan with a disbursements row (the
// realistic post-pay-out state). disbursed=false leaves it 'pending_disbursement'
// so the demo can show a CFO releasing funds.
async function makeLoan(employeeNo, kind, amount, tenor, startDate, disbursed = true) {
  const { appId, product } = await makeApp(employeeNo, kind, amount, tenor, "approved");
  const rate = product.interest_applies ? RATE : 0;
  const status = disbursed ? "active" : "pending_disbursement";
  // annual_rate is stored as a FRACTION (0.095 = 9.5%), matching the real
  // write path (resolveRate() in approvals.ts) — do NOT multiply by 100 here,
  // that was this script's own copy of the unit bug fixed elsewhere this
  // session, and it desynced demo data from what production actually stores.
  const [loan] = await sql`
    INSERT INTO loans
      (tenant_id, application_id, principal, annual_rate, rate_mode,
       start_date, tenor_months, status)
    VALUES (${T}, ${appId}, ${amount}, ${rate},
            ${product.interest_applies ? "index_plus_margin" : "fixed"},
            ${startDate}, ${tenor}, ${status})
    RETURNING id`;

  // Record the money movement for disbursed loans, so the disbursements table
  // and audit trail reflect reality (approval ≠ disbursement).
  if (disbursed) {
    await sql`
      INSERT INTO disbursements
        (tenant_id, loan_id, method, amount, reference, disbursed_at)
      VALUES (${T}, ${loan.id}, 'to_employee', ${amount},
              ${MARK + " seed"}, ${startDate})`;
  }

  // Engine computes the real reducing-balance schedule.
  const schedule = generateSchedule({
    principal: amount,
    annualRate: rate,
    tenorMonths: tenor,
    paymentsPerYear: 12,
    startDate: new Date(startDate),
    decimals: 0,
  });

  const [sched] = await sql`
    INSERT INTO loan_schedules (tenant_id, loan_id, version, engine_version, is_active)
    VALUES (${T}, ${loan.id}, 1, 'demo-seed', true) RETURNING id`;

  for (const line of schedule.lines) {
    await sql`
      INSERT INTO schedule_lines
        (tenant_id, schedule_id, period_no, due_date, opening_balance,
         principal_due, interest_due, instalment, closing_balance)
      VALUES (${T}, ${sched.id}, ${line.period}, ${line.dueDate},
              ${line.openingBalance}, ${line.principal}, ${line.interest},
              ${line.instalment}, ${line.closingBalance})`;
  }
  console.log(`loan: ${kind} ${amount.toLocaleString()} for ${employeeNo} (${schedule.lines.length} lines)`);
}

// ---- the demo book ---------------------------------------------------------
// Approved, active loans — populate exposure, interest book, product mix.
await makeLoan("ST002", "advance", 2000000, 3, "2026-05-01");   // staff advance
await makeLoan("ST002", "term",    12000000, 24, "2026-03-01"); // staff development
await makeLoan("ST003", "asset",   48000000, 36, "2026-01-15"); // HR car loan (Finance/People — OUTSIDE Ops dept)
await makeLoan("ST001", "advance", 800000, 2, "2026-06-01");    // CFO small advance (OUTSIDE Ops dept)

// Operations staff (report to Isaac/ST005) — these are what his DEPARTMENT
// view shows. Kept separate from ST001/ST003 so the dept view is a visible
// subset of the whole book, not the same set.
await makeLoan("ST006", "term",    6000000, 18, "2026-04-01");  // supervisor development
await makeLoan("ST007", "advance", 1200000, 3, "2026-06-01");   // machinist advance
await makeLoan("ST008", "asset",   9000000, 24, "2026-02-01");  // welder small car loan

// One APPROVED-BUT-NOT-YET-DISBURSED loan, so the demo can show a CFO
// releasing funds (pending_disbursement -> active + disbursements row).
await makeLoan("ST007", "term", 4000000, 12, "2026-07-15", false); // awaiting disbursement

// Pending applications — populate the approval queue + AWAITING YOU.
await makeApp("ST002", "term", 9000000, 18, "submitted");   // at dept_head (Isaac)
await makeApp("ST003", "asset", 30000000, 30, "in_review"); // HR — routes past Isaac now
await makeApp("ST002", "advance", 1500000, 3, "submitted"); // at dept_head (Isaac)
await makeApp("ST006", "advance", 900000, 3, "submitted");  // Ops — at dept_head (Isaac)

console.log("demo seed complete");
await sql.end();
