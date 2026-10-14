// scripts/operator-sql.mjs — create a platform operator WITHOUT a database connection.
//
//   npm run operator:sql
//
// For when connecting from your machine to the production database is the problem
// (wrong string, blocked network). It asks for an email and name, generates a password,
// hashes it here (argon2id, the same as the app), and COPIES a ready-to-run SQL
// statement to your clipboard. You paste that into the Supabase dashboard's SQL Editor
// and press Run; that session already has the rights. Nothing secret is written to disk
// or printed except the password, shown once for your password manager.
//
// The SQL does exactly what scripts/onboard-super-admin.mjs does: add (or update) the
// user and mark them an active platform admin. Running it again resets the password.
//
//   --print   print the SQL instead of copying it (used by tests; the hash is not secret
//             like a password but is still a credential to crack, so avoid sharing it).
import readline from "node:readline";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import argon2 from "argon2";

const print = process.argv.includes("--print");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
const lines = [];
const waiting = [];
let closed = false;
rl.on("line", (l) => (waiting.length ? waiting.shift()(l) : lines.push(l)));
rl.on("close", () => { closed = true; while (waiting.length) waiting.shift()(""); });
async function ask(q) {
  process.stdout.write(q);
  const a = lines.length ? lines.shift() : closed ? "" : await new Promise((res) => waiting.push(res));
  return a.trim();
}
const lit = (s) => `'${s.replace(/'/g, "''")}'`; // SQL string literal

const email = (await ask("Operator email: ")).toLowerCase();
const name = await ask("Operator name: ");
rl.close();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) {
  console.error("An email and a name are required. Nothing was done.");
  process.exit(1);
}

const password = randomBytes(18).toString("base64url");
const hash = await argon2.hash(password, { type: argon2.argon2id });

const sql = `-- Wola: create or reset a platform operator. Run once in the Supabase SQL Editor.
WITH u AS (
  INSERT INTO users (email, name, status, password_hash)
  VALUES (${lit(email)}, ${lit(name)}, 'active', ${lit(hash)})
  ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash
  RETURNING id
)
INSERT INTO super_admins (user_id, status)
SELECT id, 'active' FROM u
ON CONFLICT (user_id) DO UPDATE SET status = 'active'
RETURNING user_id;
`;

if (print) {
  process.stdout.write("\n" + sql + "\n");
} else {
  const clip = process.platform === "win32" ? ["clip"] : process.platform === "darwin" ? ["pbcopy"] : ["xclip", "-selection", "clipboard"];
  const r = spawnSync(clip[0], clip.slice(1), { input: sql, shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error("Could not copy to the clipboard. Run again with --print and copy the SQL by hand.");
    process.exit(1);
  }
}

console.log("\n------------------------------------------------------------");
console.log(`Operator:  ${email}`);
console.log(`Password:  ${password}`);
console.log("------------------------------------------------------------");
if (!print) {
  console.log("The SQL is on your clipboard. Do these IN THIS ORDER (copying anything else replaces the SQL):");
  console.log("  1. Supabase dashboard -> SQL Editor -> New query -> Ctrl+V (the text starts with '-- Wola:') -> Run.");
  console.log("  2. It should show one row with a user_id. If it shows an error, do NOT copy anything:");
  console.log("     just run this command again.");
  console.log("  3. ONLY NOW copy the password above into your password manager.");
  console.log("  4. Delete the query in the SQL Editor's list (it is saved there), and close this terminal.");
}
