// scripts/migrate.mjs — forward-only SQL migration runner.
// Runs as the ADMIN role (DDL); the app never gets DDL rights.
// Usage: DATABASE_ADMIN_URL=postgres://... node scripts/migrate.mjs
import postgres from "postgres";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import "dotenv/config";


const url = process.env.DATABASE_ADMIN_URL;
if (!url) { console.error("DATABASE_ADMIN_URL is required"); process.exit(1); }

const dir = path.resolve(import.meta.dirname, "../packages/db/migrations");
const sql = postgres(url, { max: 1 });

await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;

const applied = new Set((await sql`SELECT name FROM schema_migrations`).map(r => r.name));
const files = (await readdir(dir)).filter(f => f.endsWith(".sql")).sort();

for (const f of files) {
  if (applied.has(f)) { console.log(`skip  ${f}`); continue; }
  const body = await readFile(path.join(dir, f), "utf8");
  console.log(`apply ${f}`);
  await sql.unsafe(body); // each file manages its own BEGIN/COMMIT
  await sql`INSERT INTO schema_migrations (name) VALUES (${f})`;
}
await sql.end();
console.log("migrations complete");
