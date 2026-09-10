// scripts/onboard-super-admin.mjs — provision the FIRST platform operator.
// The chicken-and-egg step the architecture doc names explicitly (§7.4.4):
// there is no UI to invite the very first super-admin, since the super-admin
// UI itself requires being logged in as one. Idempotent: safe to re-run
// (upserts by email); re-running resets the password, matching
// onboard-tenant.mjs's own idempotency contract. Thereafter, further
// super-admins are provisioned by inviting them from inside /admin (once
// that flow exists — see TASKS.md) or by re-running this script.
//
// Usage:
//   node --import dotenv/config scripts/onboard-super-admin.mjs
// Reads from env:
//   SUPER_ADMIN_EMAIL, SUPER_ADMIN_NAME, SUPER_ADMIN_PASSWORD, DATABASE_ADMIN_URL
import postgres from "postgres";
import argon2 from "argon2";
import "dotenv/config";

const need = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`Missing required env: ${k}`); process.exit(1); }
  return v;
};

const email = need("SUPER_ADMIN_EMAIL").trim().toLowerCase();
const name = need("SUPER_ADMIN_NAME");
const password = need("SUPER_ADMIN_PASSWORD");
const url = need("DATABASE_ADMIN_URL");

const sql = postgres(url, { max: 1 });

try {
  const hash = await argon2.hash(password, { type: argon2.argon2id });

  // users is global — reuse the row if this email already exists (e.g. the
  // operator is also a tenant member somewhere), never create a duplicate.
  const [user] = await sql`
    INSERT INTO users (email, name, status, password_hash)
    VALUES (${email}, ${name}, 'active', ${hash})
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash
    RETURNING id`;

  await sql`
    INSERT INTO super_admins (user_id, status)
    VALUES (${user.id}, 'active')
    ON CONFLICT (user_id) DO UPDATE SET status = 'active'`;

  console.log("Super-admin provisioned:");
  console.log(`  ${name} <${email}>`);
  console.log("");
  console.log("Sign in at /admin/login on the apex domain (no tenant subdomain).");
} catch (e) {
  console.error("Onboarding failed:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
