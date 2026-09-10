// scripts/onboard-tenant.mjs — provision ONE tenant + its first admin user.
// This is the on-prem / single-tenant install step (SaaS uses a signup flow
// instead). Idempotent: safe to re-run; it upserts the tenant and admin.
//
// Reads from env (set these in the client's .env before running):
//   WOLA_TENANT_SLUG      e.g. "acme"          (must match WOLA_SINGLE_TENANT)
//   WOLA_TENANT_NAME      e.g. "Acme Ltd"
//   WOLA_ADMIN_EMAIL      first admin login
//   WOLA_ADMIN_NAME       first admin display name
//   WOLA_ADMIN_PASSWORD   first admin password (hashed here, never stored raw)
//   DATABASE_ADMIN_URL    admin connection (runs DDL-free inserts as owner)
//
// Usage: node --import dotenv/config scripts/onboard-tenant.mjs
import postgres from "postgres";
import argon2 from "argon2";
import "dotenv/config";

const need = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`Missing required env: ${k}`); process.exit(1); }
  return v;
};

const slug = need("WOLA_TENANT_SLUG");
const name = need("WOLA_TENANT_NAME");
const adminEmail = need("WOLA_ADMIN_EMAIL");
const adminName = need("WOLA_ADMIN_NAME");
const adminPassword = need("WOLA_ADMIN_PASSWORD");
const url = need("DATABASE_ADMIN_URL");

if (process.env.WOLA_SINGLE_TENANT && process.env.WOLA_SINGLE_TENANT !== slug) {
  console.error(
    `WOLA_SINGLE_TENANT (${process.env.WOLA_SINGLE_TENANT}) does not match ` +
    `WOLA_TENANT_SLUG (${slug}). On-prem: these must be the same tenant.`,
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

try {
  // 1. Tenant (upsert by slug).
  const [tenant] = await sql`
    INSERT INTO tenants (slug, name, status)
    VALUES (${slug}, ${name}, 'active')
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id`;
  const tenantId = tenant.id;

  // 2. Admin user (upsert by email). Password hashed with argon2 — never stored
  //    in plaintext, matching the app's auth.
  const hash = await argon2.hash(adminPassword);
  const [user] = await sql`
    INSERT INTO users (email, name, status, password_hash)
    VALUES (${adminEmail}, ${adminName}, 'active', ${hash})
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash
    RETURNING id`;

  // 3. Membership: make them org_admin of this tenant. The role enum uses
  //    'org_admin' (not 'admin'), and the unique key is (tenant_id, user_id,
  //    role), so conflict-do-nothing is the correct idempotent upsert.
  await sql`
    INSERT INTO memberships (tenant_id, user_id, role)
    VALUES (${tenantId}, ${user.id}, 'org_admin')
    ON CONFLICT (tenant_id, user_id, role) DO NOTHING`;

  console.log("On-prem tenant provisioned:");
  console.log(`  Company : ${name} (${slug})`);
  console.log(`  Admin   : ${adminName} <${adminEmail}>`);
  console.log("");
  console.log("Next: set WOLA_SINGLE_TENANT=" + slug + " in .env, then start the app.");
  console.log("The admin can log in and configure loan products, staff, and roles.");
} catch (e) {
  console.error("Onboarding failed:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
