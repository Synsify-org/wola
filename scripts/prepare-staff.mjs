// scripts/prepare-staff.mjs: turn a client's staff list into Wola's import file, and tell you
// what still needs a decision. Reads the client's own .xlsx (or a .csv exported from it).
//
//   npm run staff:prepare -- "C:\path\to\staff list.xlsx" --org "MUA Insurance Uganda"
//
// When the client's HR system export (employee number, name, email, department, title, status) is the
// main list and a second list carries the line managers, merge them:
//   npm run staff:prepare -- "<hr export.csv>" --managers "<line managers.xlsx>" --org "..." --practice-pay
//   --managers <file>    a second list (.xlsx or .csv) with a line-manager column; matched by employee number, then name
//   --practice-pay       fill in INVENTED pay and probation status, for a TRIAL organisation only
//                        (the review says so in capitals; never load that file into a real organisation)
//
// Writes three files to onboarding-data/<name>/ (a folder git ignores, because it holds staff names):
//   employees.csv   for Settings -> Employees -> Import employees (salary / probation blank unless the sheet had them)
//   accounts.csv    who should get which Wola role, with a column for work emails
//   review.md       the plain-language list of problems and questions for the client's HR
// It changes no database. Run it again whenever the client sends a corrected list.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { readXlsx } from "./lib/xlsx-lite.mjs";
import { analyse } from "./lib/staff-sheet.mjs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const input = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && args[i - 1] !== "--practice-pay"));
if (!input) {
  console.error('Usage: npm run staff:prepare -- "<staff list.xlsx or .csv>" --org "Organisation name" [--out onboarding-data/<name>]');
  process.exit(1);
}
const org = opt("org") ?? "the organisation";
const slug = org.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-")[0] || "client";
const out = path.resolve(opt("out") ?? path.join("onboarding-data", slug));

// A small CSV reader (quotes allowed) for lists exported from Excel.
function csvRows(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const load = (file) => {
  const buf = readFileSync(file);
  return /\.xlsx$/i.test(file) ? readXlsx(buf).rows : csvRows(buf.toString("utf8").replace(/^\uFEFF/, ""));
};
const managersFile = opt("managers");
const practice = args.includes("--practice-pay");

let rows;
try {
  rows = load(input);
  var result = analyse(rows, {
    org, practice,
    source: managersFile ? `${path.basename(input)} + ${path.basename(managersFile)}` : path.basename(input),
    managerRows: managersFile ? load(managersFile) : null,
  });
} catch (e) {
  console.error(`Could not read ${input}: ${e.message}`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "employees.csv"), result.import);
writeFileSync(path.join(out, "accounts.csv"), result.accounts);
writeFileSync(path.join(out, "review.md"), result.review);

const attention = result.notes.filter((n) => ["provisional", "duplicate", "unresolved", "ambiguous", "cycle", "dual", "assumed", "typo", "nomanager", "email"].includes(n.kind));
console.log(`\n${result.people.length} people read for ${org}.`);
console.log(`${attention.length} item${attention.length === 1 ? "" : "s"} for the client's HR to decide:`);
for (const n of attention) console.log("  - " + n.text);
console.log(`\nWrote to ${out}:\n  employees.csv  accounts.csv  review.md\nOpen review.md first.`);
