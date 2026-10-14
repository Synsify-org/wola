// scripts/tenant-sql.mjs: create a client organisation WITHOUT a database connection from this machine.
//
//   npm run tenant:sql -- --slug mua --name "MUA Insurance Uganda" ^
//       --admin-email person@client.com --admin-name "Their Name" --origin https://mua.example.com
//
//   --template benefit-scheme   (default) the staff-loan products and approval chains agreed with MUA
//   --template blank            just the organisation and its first administrator
//   --show-link                 also print the invitation link (use only if email is not working yet)
//   --print                     print the SQL instead of copying it to the clipboard
//
// It copies ready-to-run SQL to your clipboard; you paste it into the Supabase dashboard's SQL Editor
// and press Run (that session already has the rights). No password exists anywhere: the first
// administrator gets an invitation email and chooses their own. See docs/ONBOARDING.md.
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tenantSql, validate } from "./lib/tenant-sql.mjs";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (n) => args.includes(`--${n}`);

const input = {
  slug: opt("slug"), name: opt("name"), adminEmail: opt("admin-email"), adminName: opt("admin-name"),
  origin: (opt("origin") ?? "").replace(/\/$/, ""), template: opt("template") ?? "benefit-scheme",
};
const errors = validate(input);
if (errors.length) {
  console.error("Cannot create the SQL yet:\n  - " + errors.join("\n  - "));
  console.error('\nExample:\n  npm run tenant:sql -- --slug mua --name "MUA Insurance Uganda" --admin-email person@client.com --admin-name "Their Name" --origin https://mua.example.com');
  process.exit(1);
}

const { sql, link } = tenantSql({ ...input, token: randomBytes(32).toString("hex") });

if (flag("print")) {
  process.stdout.write(sql);
} else {
  const clip = process.platform === "win32" ? ["clip"] : process.platform === "darwin" ? ["pbcopy"] : ["xclip", "-selection", "clipboard"];
  const r = spawnSync(clip[0], clip.slice(1), { input: sql, shell: process.platform === "win32" });
  if (r.status !== 0) { console.error("Could not copy to the clipboard. Run again with --print and copy it by hand."); process.exit(1); }
  console.log(`Copied the SQL for "${input.name}" (${input.slug}) to your clipboard.\n`);
  console.log("Do these IN THIS ORDER (copying anything else replaces the SQL):");
  console.log("  1. Supabase dashboard -> SQL Editor -> New query -> Ctrl+V (it starts '-- Wola: create the organisation') -> Run.");
  console.log("  2. The last result is one row: products 3, approval_stages 23, invitations 1, emails_queued 1 (for the default template).");
  console.log("     An error means NOTHING was created; read the message (usually: the short name is taken) and run this again.");
  console.log("  3. Delete that query from the SQL Editor's list (it contains the invitation).");
  console.log(`\nThe administrator (${input.adminEmail}) now receives an invitation email within a few minutes.`);
}
if (flag("show-link")) console.log(`\nInvitation link (secret; send it only to ${input.adminEmail}):\n${link}`);
else if (!flag("print")) console.log("\nIf email is not set up yet, run again with --show-link to get the invitation link to send them yourself.");
