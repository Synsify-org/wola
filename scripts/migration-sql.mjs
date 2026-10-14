// scripts/migration-sql.mjs — apply migrations WITHOUT a database connection from this machine.
//
//   npm run migration:sql -- 0026 0027
//
// For when connecting to the database from your computer is the problem. It reads the named
// migration files, adds the line that records each as applied (exactly what scripts/migrate.mjs
// does), and COPIES the lot to your clipboard. Paste it into the Supabase dashboard's SQL
// Editor and press Run: that session already has the rights.
//
// Safe to run twice: it skips a migration already recorded, and each file keeps its own
// BEGIN/COMMIT. Name migrations by number prefix ("0026") or full file name.
//
//   --print   print instead of copying (used by tests)
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const print = args.includes("--print");
const wanted = args.filter((a) => !a.startsWith("--"));
const check = args.includes("--check");
if (wanted.length === 0 && !check) {
  console.error("Name the migrations to apply, e.g.  npm run migration:sql -- 0026 0027");
  console.error("Or see which are applied (read-only):  npm run migration:sql -- --check");
  process.exit(1);
}

const dir = path.resolve(import.meta.dirname, "../packages/db/migrations");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

// --check: a READ-ONLY query for the Supabase SQL Editor. Lists every migration this version of
// the code expects as "applied" or "MISSING" (missing first), so nobody has to read a table.
if (check) {
  const values = files.map((f) => `('${f}')`).join(", ");
  const q = `-- Wola: which migrations are applied? Read-only: changes nothing.
` +
    `SELECT f.name, CASE WHEN m.name IS NULL THEN 'MISSING' ELSE 'applied' END AS status, m.applied_at
` +
    `FROM (VALUES ${values}) AS f(name)
` +
    `LEFT JOIN schema_migrations m ON m.name = f.name
` +
    `ORDER BY (m.name IS NOT NULL), f.name DESC
` +
    `LIMIT 12;
`;
  if (print) { process.stdout.write(q); process.exit(0); }
  const clip = process.platform === "win32" ? ["clip"] : process.platform === "darwin" ? ["pbcopy"] : ["xclip", "-selection", "clipboard"];
  const r = spawnSync(clip[0], clip.slice(1), { input: q, shell: process.platform === "win32" });
  if (r.status !== 0) { console.error("Could not copy to the clipboard. Run again with --check --print and copy it by hand."); process.exit(1); }
  console.log(`Copied a read-only check (${files.length} migrations known to this version) to your clipboard.`);
  console.log("Supabase dashboard -> SQL Editor -> New query -> Ctrl+V -> Run.");
  console.log("Any row saying MISSING is not applied yet; everything 'applied' means you are up to date.");
  process.exit(0);
}
const picked = [];
for (const w of wanted) {
  const hit = files.filter((f) => f === w || f === `${w}.sql` || f.startsWith(`${w}_`));
  if (hit.length !== 1) {
    console.error(hit.length === 0 ? `No migration matches "${w}".` : `"${w}" matches more than one file: ${hit.join(", ")}.`);
    process.exit(1);
  }
  if (!picked.includes(hit[0])) picked.push(hit[0]);
}
picked.sort();

let sql = `-- Wola: apply ${picked.length} migration${picked.length === 1 ? "" : "s"} (${picked.join(", ")}).\n-- Run once in the Supabase SQL Editor. Safe to run twice: a migration already recorded is skipped.\n-- All-or-nothing: if anything fails, nothing from this script is applied.\n\n`;
sql += `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());\n\n`;
for (const f of picked) {
  let body = (await readFile(path.join(dir, f), "utf8")).replace(/\r\n/g, "\n").trim();
  // Each file manages its own BEGIN/COMMIT for the command-line runner; here the whole script is
  // one unit, and a DO block can't contain them, so they are removed.
  body = body.replace(/^BEGIN;\s*$/m, "").replace(/^COMMIT;\s*$(?![\s\S]*^COMMIT;)/m, "").trim();
  if (body.includes("$wola_body$")) { console.error(`${f} contains the reserved quote tag $wola_body$.`); process.exit(1); }
  sql += `-- ---- ${f}\nDO $wola_mig$\nBEGIN\n  IF EXISTS (SELECT 1 FROM schema_migrations WHERE name = '${f}') THEN\n    RAISE NOTICE 'already applied: ${f}';\n  ELSE\n    EXECUTE $wola_body$\n${body}\n    $wola_body$;\n    INSERT INTO schema_migrations (name) VALUES ('${f}');\n  END IF;\nEND\n$wola_mig$;\n\n`;
}
sql += `SELECT name, applied_at FROM schema_migrations ORDER BY name DESC LIMIT 5;\n`;

if (print) {
  process.stdout.write(sql);
} else {
  const clip = process.platform === "win32" ? ["clip"] : process.platform === "darwin" ? ["pbcopy"] : ["xclip", "-selection", "clipboard"];
  const r = spawnSync(clip[0], clip.slice(1), { input: sql, shell: process.platform === "win32" });
  if (r.status !== 0) { console.error("Could not copy to the clipboard. Run again with --print and copy it by hand."); process.exit(1); }
  console.log(`Copied the SQL for ${picked.join(", ")} to your clipboard (${sql.split("\n").length} lines).`);
  console.log("Now: Supabase dashboard -> SQL Editor -> New query -> Ctrl+V (it starts '-- Wola: apply') -> Run.");
  console.log("The last result lists the newest recorded migrations; yours should be at the top.");
  console.log("Afterwards delete that query from the SQL Editor's list.");
}
