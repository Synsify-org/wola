// scripts/seed-mua-accounts.mjs — creates login accounts for the 6 people who
// need to actively act in the MUA demo (drive real approvals, show role-aware
// dashboards). Real email pattern confirmed by the client: first-initial +
// last-word-of-name @mua.co.ug (only nlutakome@mua.co.ug was explicitly
// confirmed; the other 5 are derived the same way — flag if any collide with
// a real address).
//
// Role mapping (see canAct in packages/engine/src/approval.ts): the
// dept_head stage resolves by employeeId === department_head_id, which is
// ALREADY correct via the CSV import — it needs no membership role at all.
// Only the FIXED stage roles (hr/cfo/ceo/coo) need an exact role match, so
// only people filling those slots — plus the two Chiefs with no matching
// slot, given dept_head role for a proper Approvals worklist — get one here.
//
// Usage: node --import dotenv/config scripts/seed-mua-accounts.mjs
import postgres from "postgres";
import * as argon2 from "argon2";
import "dotenv/config";

const url = process.env.DATABASE_ADMIN_URL;
const sql = postgres(url, { max: 1 });

const [t] = await sql`SELECT id FROM tenants WHERE slug = 'mua'`;
if (!t) { console.error("mua tenant not found — run setup-mua-tenant.mjs first"); process.exit(1); }
const T = t.id;

const DEMO_PASSWORD = "MuaDemo2026!";
const hash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

const accounts = [
  { no: "MUA001", email: "nlutakome@mua.co.ug", role: "ceo" },       // Nicholas Lutakome — confirmed real pattern
  { no: "MUA006", email: "rntege@mua.co.ug", role: "cfo" },          // Robert Ntege Lubwama
  { no: "MUA035", email: "essematimba@mua.co.ug", role: "hr" },      // Evelyn Lwanga Ssematimba
  { no: "MUA042", email: "rimandi@mua.co.ug", role: "coo" },         // Ramana Kumar Imandi
  { no: "MUA072", email: "mzaake@mua.co.ug", role: "dept_head" },    // Michael Zaake
  { no: "MUA037", email: "adragu@mua.co.ug", role: "dept_head" },    // Angela Dragu
];

for (const a of accounts) {
  const [emp] = await sql`SELECT id, full_name FROM employees WHERE tenant_id = ${T} AND employee_no = ${a.no}`;
  if (!emp) { console.error(`employee ${a.no} not found, skipping`); continue; }

  const [user] = await sql`
    INSERT INTO users (email, name, status, password_hash)
    VALUES (${a.email}, ${emp.full_name}, 'active', ${hash})
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    RETURNING id`;

  await sql`
    INSERT INTO memberships (tenant_id, user_id, role)
    VALUES (${T}, ${user.id}, ${a.role})
    ON CONFLICT (tenant_id, user_id, role) DO NOTHING`;

  await sql`UPDATE employees SET user_id = ${user.id} WHERE id = ${emp.id}`;

  console.log(`${emp.full_name.padEnd(28)} ${a.email.padEnd(24)} role=${a.role}`);
}

console.log(`\nAll 6 accounts share the password: ${DEMO_PASSWORD}`);
await sql.end();
