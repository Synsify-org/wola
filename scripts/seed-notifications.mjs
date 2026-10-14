// scripts/seed-notifications.mjs — a few believable notifications for the demo, so the bell
// isn't empty on first sign-in. Real links (to real applications and loans), so clicking
// works. Idempotent in effect: demo-reset wipes the database first.
//
// Usage: node --import dotenv/config scripts/seed-notifications.mjs
import postgres from "postgres";
import "dotenv/config";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) { console.error("DATABASE_ADMIN_URL required"); process.exit(1); }
const sql = postgres(url, { max: 1 });

try {
  const [t] = await sql`SELECT id FROM tenants WHERE slug = 'testco'`;
  if (!t) { console.error("testco not found"); process.exit(1); }
  const T = t.id;
  const user = async (email) => (await sql`SELECT id FROM users WHERE email = ${email}`)[0]?.id;
  const put = (userId, kind, title, body, href, minutesAgo, read = false) => userId
    ? sql`INSERT INTO notifications (tenant_id, user_id, kind, title, body, href, created_at, read_at)
          VALUES (${T}, ${userId}, ${kind}, ${title}, ${body}, ${href}, now() - ${minutesAgo + " minutes"}::interval, ${read ? sql`now()` : null})`
    : null;

  const pending = await sql`
    SELECT la.id, e.full_name, lp.name AS product, la.amount FROM loan_applications la
    JOIN employees e ON e.id = la.employee_id JOIN loan_products lp ON lp.id = la.loan_product_id
    WHERE la.tenant_id = ${T} AND la.status IN ('submitted', 'in_review') ORDER BY la.created_at DESC LIMIT 2`;
  const loans = await sql`
    SELECT l.id, e.user_id, lp.name AS product, l.status FROM loans l
    JOIN loan_applications la ON la.id = l.application_id JOIN employees e ON e.id = la.employee_id
    JOIN loan_products lp ON lp.id = la.loan_product_id
    WHERE l.tenant_id = ${T} AND e.user_id IS NOT NULL ORDER BY l.created_at DESC LIMIT 3`;

  const cfo = await user("cfo@testco.io"), ceo = await user("ceo@testco.io"), hr = await user("hr@testco.io");
  let n = 0;
  for (const [i, p] of pending.entries()) {
    const what = `${p.full_name}: ${p.product} of UGX ${Math.round(Number(p.amount)).toLocaleString()}`;
    for (const u of [cfo, ceo, hr]) { await put(u, "application.awaiting", "Awaiting your decision", what, `/applications/${p.id}`, 12 + i * 95); n++; }
  }
  for (const [i, l] of loans.entries()) {
    await put(l.user_id, "loan.disbursed", "Your loan was disbursed", `${l.product}: your repayment schedule is now active.`, `/loans/${l.id}`, 60 * 26 + i * 400, i > 0);
    n++;
  }
  await put(cfo, "early.requested", "Early repayment requested", "A borrower wants to pay off a loan early. Record it when the money arrives.", "/reconciliation", 300, true);
  n++;
  console.log(`    added ${n} demo notifications`);
} finally {
  await sql.end();
}
