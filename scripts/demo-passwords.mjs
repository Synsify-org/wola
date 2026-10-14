// scripts/demo-passwords.mjs: give the demo accounts strong passwords, WITHOUT a database connection.
//
//   npm run demo:passwords                       # the demo administrator and the five demo staff accounts
//   npm run demo:passwords -- --emails a@x.com,b@x.com
//   --print    print the SQL instead of copying it
//
// Why: the demo accounts started life with the shared development password. Anyone who knows the
// address and the demo email names could sign in. This makes a random password per account, shows
// them to you ONCE (put them in your password manager), and copies SQL for the Supabase SQL Editor.
// The passwords are never written to a file and the SQL holds only their hashes.
import { spawnSync } from "node:child_process";
import { passwordSql } from "./lib/demo-passwords.mjs";

const args = process.argv.slice(2);
const i = args.indexOf("--emails");
const emails = i >= 0 ? (args[i + 1] ?? "").split(",") : ["admin", "ceo", "cfo", "hr", "head", "staff"].map((r) => `${r}@testco.io`);

let out;
try { out = await passwordSql(emails); } catch (e) { console.error(e.message); process.exit(1); }

if (args.includes("--print")) process.stdout.write(out.sql);
else {
  const clip = process.platform === "win32" ? ["clip"] : process.platform === "darwin" ? ["pbcopy"] : ["xclip", "-selection", "clipboard"];
  const r = spawnSync(clip[0], clip.slice(1), { input: out.sql, shell: process.platform === "win32" });
  if (r.status !== 0) { console.error("Could not copy to the clipboard. Run again with --print and copy it by hand."); process.exit(1); }
}

console.log("\n------------------------------------------------------------");
for (const p of out.passwords) console.log(`${p.email.padEnd(24)} ${p.password}`);
console.log("------------------------------------------------------------");
console.log("Shown once. Save them in your password manager now.");
if (!args.includes("--print")) {
  console.log("\nThe SQL is on your clipboard. Do these IN THIS ORDER (copying anything else replaces the SQL):");
  console.log("  1. Supabase dashboard -> SQL Editor -> New query -> Ctrl+V (it starts '-- Wola: set new passwords') -> Run.");
  console.log(`  2. The result lists each account it changed (${out.passwords.length} expected). A missing one means that account does not exist there: fine.`);
  console.log("  3. Delete that query from the SQL Editor's list.");
}
