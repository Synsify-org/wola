// scripts/db-test-setup.mjs — make sure the local `wola_test` database exists and
// is migrated to the latest schema. Runs automatically before the test suite
// (npm "pretest:isolation"), so tests never meet a stale or missing schema.
// Idempotent. No-op in CI, where the service container is already the test DB.
import postgres from "postgres";
import { spawnSync } from "node:child_process";
import path from "node:path";
import "dotenv/config";

if (process.env.CI) { console.log("CI: using the provided database; nothing to set up."); process.exit(0); }

const admin = process.env.DATABASE_ADMIN_URL;
if (!admin) { console.error("DATABASE_ADMIN_URL is required (copy .env.example to .env)."); process.exit(1); }

const TEST_DB = process.env.WOLA_TEST_DB ?? "wola_test";
if (!/test/i.test(TEST_DB)) { console.error(`Refusing: "${TEST_DB}" doesn't look like a test database name.`); process.exit(1); }

const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString(); };

// Connect to the maintenance database to create the test one.
const sql = postgres(withDb(admin, "postgres"), { max: 1 });
try {
  const [exists] = await sql`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB}`;
  if (!exists) {
    await sql.unsafe(`CREATE DATABASE "${TEST_DB}"`);
    console.log(`created database ${TEST_DB}`);
  }
} finally {
  await sql.end();
}

// Apply any pending migrations to it (same runner as everywhere else).
const r = spawnSync(process.execPath, [path.resolve(import.meta.dirname, "migrate.mjs")], {
  stdio: ["ignore", "ignore", "inherit"],
  env: { ...process.env, DATABASE_ADMIN_URL: withDb(admin, TEST_DB) },
});
if (r.status !== 0) { console.error("migrating the test database failed"); process.exit(r.status ?? 1); }
console.log(`${TEST_DB} is ready.`);
