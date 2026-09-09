// scripts/apply-settings-grant.mjs
// One-shot: grant wola_app column-scoped UPDATE on tenants.settings and VERIFY.
// Self-contained so there's no ambiguity about whether migration 0010 ran.
//
// Usage: node --import dotenv/config scripts/apply-settings-grant.mjs
import postgres from "postgres";
import "dotenv/config";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error("DATABASE_ADMIN_URL is not set. This script needs the owner");
  console.error("connection (the same one migrate.mjs uses). Check your .env.");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

try {
  // Apply the grant (idempotent — re-running is harmless).
  await sql`GRANT UPDATE (settings) ON tenants TO wola_app`;
  console.log("GRANT executed.");

  // Verify it actually landed.
  const rows = await sql`
    SELECT privilege_type
    FROM information_schema.column_privileges
    WHERE table_name = 'tenants'
      AND column_name = 'settings'
      AND grantee = 'wola_app'`;

  if (rows.some((r) => r.privilege_type === "UPDATE")) {
    console.log("VERIFIED: wola_app now has UPDATE on tenants.settings.");
    console.log("Restart the dev server so the app pool reconnects, then save branding.");
  } else {
    console.error("GRANT ran but verification found no UPDATE privilege.");
    console.error("This usually means the app's DATABASE_URL points at a DIFFERENT");
    console.error("database than DATABASE_ADMIN_URL. Compare the two URLs.");
    process.exitCode = 1;
  }
} catch (e) {
  console.error("Failed:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
