// scripts/demo-reset.mjs — ONE command to a known-good demo database.
//
//   npm run demo:reset
//
// Wipes the LOCAL database and rebuilds it: the testco demo tenant (all roles,
// three products with approval chains, a CBR rate, a realistic book of
// applications and loans) plus a second tenant ("other") for isolation checks.
// Safe to run any number of times; the end state is identical.
//
// DESTRUCTIVE by design, so it refuses anything that isn't a local database
// (set WOLA_ALLOW_RESET=1 only if you really mean a remote scratch database).
// Test fixtures no longer land here: the test suite runs against `wola_test`.
import postgres from "postgres";
import { spawnSync } from "node:child_process";
import path from "node:path";
import "dotenv/config";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) { console.error("DATABASE_ADMIN_URL is required"); process.exit(1); }

const { hostname, pathname } = new URL(url);
const local = ["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"].includes(hostname);
if (!local && process.env.WOLA_ALLOW_RESET !== "1") {
  console.error(`Refusing to reset ${hostname}${pathname}: not a local database. (Set WOLA_ALLOW_RESET=1 to override.)`);
  process.exit(1);
}

// All demo users share this password hash (argon2id of "test1234").
const TEST_HASH = "$argon2id$v=19$m=65536,t=3,p=4$TJugSRYYjCh+ItJC9fww6A$tIUgIWP0edcSBp3DKceixC+tPseBl6zhaRoOlMbjWvI";
const here = import.meta.dirname;

const run = (script) => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "--import", "dotenv/config", path.join(here, script)], { stdio: "inherit" });
  if (r.status !== 0) { console.error(`\n${script} failed.`); process.exit(r.status ?? 1); }
};

const sql = postgres(url, { max: 1 });
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

try {
  step(1, `Wiping ${hostname}${pathname}`);
  // audit_log is append-only for the app role and has no cascade from tenants; the
  // admin role clears it here, which is exactly why this script is local-only.
  await sql`DELETE FROM audit_log`;
  const gone = await sql`DELETE FROM tenants RETURNING slug`;
  await sql`DELETE FROM users u
            WHERE NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)
              AND NOT EXISTS (SELECT 1 FROM super_admins s WHERE s.user_id = u.id)`;
  console.log(`    removed ${gone.length} tenant(s)`);

  step(2, "Base tenants, people, products, approval chains");
  run("seed-dev.mjs");
  step(3, "Names and branding");
  run("reskin-demo.mjs");

  step(4, "Executive and oversight accounts, shared test password, CBR rate");
  const [t] = await sql`SELECT id FROM tenants WHERE slug = 'testco'`;
  await sql`UPDATE tenants SET name = 'Test Co' WHERE id = ${t.id}`;
  const extra = [
    ["coo@testco.io", "Ronald Kato", "coo"],
    ["admin@testco.io", "Sarah Nabirye", "org_admin"],
    ["auditor@testco.io", "Peter Lwanga", "auditor"],
  ];
  for (const [email, name, role] of extra) {
    const [u] = await sql`
      INSERT INTO users (email, name, status, password_hash) VALUES (${email}, ${name}, 'active', ${TEST_HASH})
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
    await sql`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${t.id}, ${u.id}, ${role})
              ON CONFLICT (tenant_id, user_id, role) DO NOTHING`;
  }
  await sql`UPDATE users SET password_hash = ${TEST_HASH}, status = 'active' WHERE email LIKE '%@testco.io'`;
  await sql`DELETE FROM login_attempts WHERE email LIKE '%@testco.io'`;

  const [ri] = await sql`
    INSERT INTO rate_indices (tenant_id, name, current_value, effective_from)
    VALUES (${t.id}, 'CBR', 16.5, '2026-01-01')
    ON CONFLICT (tenant_id, name, effective_from) DO UPDATE SET current_value = EXCLUDED.current_value RETURNING id`;
  await sql`UPDATE loan_products SET rate_index_id = ${ri.id}, rate_mode = 'index', updated_at = now()
            WHERE tenant_id = ${t.id} AND interest_applies = true`;

  step(5, "A realistic book of applications and loans");
  run("seed-demo.mjs");
  step("5b", "Payroll history (last month left with a missed and a short deduction)");
  run("seed-payroll-history.mjs");

  step(6, "Verifying the known-good state");
  const [c] = await sql`
    SELECT
      (SELECT count(*)::int FROM tenants) AS tenants,
      (SELECT count(*)::int FROM memberships WHERE tenant_id = ${t.id}) AS people,
      (SELECT count(*)::int FROM loan_products WHERE tenant_id = ${t.id} AND active) AS products,
      (SELECT count(*)::int FROM approval_stages WHERE tenant_id = ${t.id} AND retired_at IS NULL) AS stages,
      (SELECT count(*)::int FROM loans WHERE tenant_id = ${t.id}) AS loans,
      (SELECT count(*)::int FROM loan_applications WHERE tenant_id = ${t.id}) AS applications`;
  console.log("   ", c);
  const roles = (await sql`SELECT DISTINCT role FROM memberships WHERE tenant_id = ${t.id} ORDER BY role`).map((r) => r.role);
  const need = ["auditor", "ceo", "cfo", "coo", "dept_head", "employee", "hr", "org_admin"];
  const problems = [];
  if (c.tenants !== 2) problems.push(`expected 2 tenants, found ${c.tenants}`);
  if (c.products !== 3) problems.push(`expected 3 products, found ${c.products}`);
  if (c.stages < 3) problems.push("approval chains missing");
  if (c.loans < 1 || c.applications < 1) problems.push("no demo loans/applications");
  for (const r of need) if (!roles.includes(r)) problems.push(`missing role ${r}`);
  if (problems.length) { console.error("\nNOT known-good:", problems.join("; ")); process.exitCode = 1; }
  else console.log("\nKnown-good. Sign in at http://testco.localhost:3000 as cfo@ / hr@ / ceo@ / coo@ / head@ / staff@ / admin@ / auditor@testco.io, password test1234.");
} finally {
  await sql.end();
}
