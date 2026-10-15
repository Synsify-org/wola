// scripts/seed-payroll-history.mjs — gives the demo book a payroll history, so the
// Payroll screen opens on a believable month instead of "every loan is behind".
//
// For testco: every month before last is recorded as fully deducted (one bulk run per
// month, through the real ledger code). LAST month is left deliberately imperfect, one
// loan missed and one short, so there is something to resolve in a demo.
// Safe to re-run: a bulk run records only what is still owed for its month, and the
// imperfect last month is skipped once it has any payroll deduction.
//
// Usage: node --import tsx --import dotenv/config scripts/seed-payroll-history.mjs
import postgres from "postgres";
import { cycleReport, postBulkRun } from "../packages/db/src/payroll.ts";
import { recordRepayment } from "../packages/db/src/loans.ts";
import { cycleBounds, shiftCycle } from "@wola/engine";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) { console.error("DATABASE_ADMIN_URL required"); process.exit(1); }
// Same rule as demo-reset: invented history never lands on a remote database by accident.
const { hostname } = new URL(url);
const local = ["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"].includes(hostname);
if (!local && process.env.WOLA_ALLOW_RESET !== "1") {
  console.error(`Refusing to seed ${hostname}: not a local database. (Set WOLA_ALLOW_RESET=1 to override.)`);
  process.exit(1);
}
const sql = postgres(url, { max: 1 });

try {
  const [tenant] = await sql`SELECT id FROM tenants WHERE slug = 'testco'`;
  if (!tenant) { console.error("testco not found"); process.exit(1); }
  const T = tenant.id;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const lastMonth = shiftCycle(thisMonth, -1);
  const [{ first }] = await sql`SELECT to_char(min(start_date), 'YYYY-MM') AS first FROM loans WHERE tenant_id = ${T} AND status = 'active'`;
  if (!first) { console.log("no active loans; nothing to record"); process.exit(0); }

  let months = 0, rows = 0, lastSkipped = false;
  await sql.begin(async (tx) => {
    for (let c = first; c < lastMonth; c = shiftCycle(c, 1)) {
      const r = await postBulkRun(tx, { tenantId: T, cycle: c, actorId: null, today: cycleBounds(c).end });
      months++; rows += r.posted;
    }
    // Last month: imperfect on purpose, but only once (recordRepayment is not idempotent).
    const { start, end } = cycleBounds(lastMonth);
    const [{ n }] = await tx`SELECT count(*)::int AS n FROM repayments
      WHERE tenant_id = ${T} AND source = 'payroll' AND value_date BETWEEN ${start} AND ${end}`;
    if (n > 0) { lastSkipped = true; return; }
    const rep = await cycleReport(tx, T, lastMonth, cycleBounds(lastMonth).end);
    const todo = rep.lines.filter((l) => l.remaining > 0.5);
    for (const [i, l] of todo.entries()) {
      if (i === 0) continue;                                   // missed: nothing deducted
      const amount = i === 1 ? Math.round(l.remaining / 2) : l.remaining;  // short, then in full
      await recordRepayment(tx, { tenantId: T, loanId: l.loanId, amount, source: "payroll", valueDate: new Date(cycleBounds(lastMonth).end) });
      rows++;
    }
    months++;
  });
  console.log(`    recorded ${rows} deductions over ${months} month(s); ` +
    (lastSkipped ? `${cycleBounds(lastMonth).label} already had deductions, left as is` : `${cycleBounds(lastMonth).label} left with one missed and one short`));
} finally {
  await sql.end();
}
