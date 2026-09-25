// scripts/migrate.mjs — forward-only SQL migration runner.
// Runs as the ADMIN role (DDL); the app never gets DDL rights.
//
// Usage:
//   DATABASE_ADMIN_URL=postgres://... node scripts/migrate.mjs            apply pending
//   DATABASE_ADMIN_URL=postgres://... node scripts/migrate.mjs --dry-run  list pending, change nothing
//
// It loads .env (local dev defaults) but an explicitly set DATABASE_ADMIN_URL
// always wins. It prints the target host first — check it before trusting
// the run, so a forgotten env var can't silently migrate the wrong database.
import postgres from "postgres";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import "dotenv/config";

const dryRun = process.argv.includes("--dry-run");
const url = process.env.DATABASE_ADMIN_URL;
if (!url) { console.error("DATABASE_ADMIN_URL is required"); process.exit(1); }

// Show where we're pointed — never the password.
const target = (() => {
  try {
    const u = new URL(url);
    return `${u.username}@${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch { return "(unparseable DATABASE_ADMIN_URL)"; }
})();
console.log(`${dryRun ? "DRY RUN — " : ""}target: ${target}`);

const dir = path.resolve(import.meta.dirname, "../packages/db/migrations");
// prepare: false — works through Supabase's transaction pooler (:6543) as
// well as direct/session connections; harmless everywhere else.
const sql = postgres(url, { max: 1, prepare: false });

const files = (await readdir(dir)).filter(f => f.endsWith(".sql")).sort();

if (dryRun) {
  const [{ exists }] = await sql`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`;
  if (!exists) {
    console.log("\n!! No schema_migrations table: this database was not set up by this runner.");
    console.log("!! A real run would try to apply EVERY migration from 0001 — do not run it");
    console.log("!! until the already-applied migrations are recorded in schema_migrations.");
    await sql.end();
    process.exit(2);
  }
  const applied = new Set((await sql`SELECT name FROM schema_migrations`).map(r => r.name));
  const pending = files.filter(f => !applied.has(f));
  console.log(`${applied.size} applied, ${pending.length} pending${pending.length ? ":" : "."}`);
  for (const f of pending) console.log(`  would apply ${f}`);
  await sql.end();
  process.exit(0);
}

await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;

const applied = new Set((await sql`SELECT name FROM schema_migrations`).map(r => r.name));

for (const f of files) {
  if (applied.has(f)) { console.log(`skip  ${f}`); continue; }
  const body = await readFile(path.join(dir, f), "utf8");
  console.log(`apply ${f}`);
  await sql.unsafe(body); // each file manages its own BEGIN/COMMIT
  await sql`INSERT INTO schema_migrations (name) VALUES (${f})`;
}
await sql.end();
console.log("migrations complete");
