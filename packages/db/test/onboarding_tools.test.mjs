// The client-onboarding tools: reading a spreadsheet, and turning a staff list into an import.
// Made-up people only: real client data never goes in the repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readXlsx } from "../../../scripts/lib/xlsx-lite.mjs";
import { analyse, mapColumns, titleCase } from "../../../scripts/lib/staff-sheet.mjs";

// ---- a minimal .xlsx, built here: a zip with the stored (uncompressed) method -----------------
function crc32(buf) { let c, crc = ~0; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function zip(files) {
  const locals = [], central = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8"), nm = Buffer.from(name), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nm, data); central.push(ch, nm); offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const xlsx = (rows) => {
  const strings = [], idx = (s) => { let i = strings.indexOf(s); if (i < 0) { strings.push(s); i = strings.length - 1; } return i; };
  const col = (n) => String.fromCharCode(65 + n);
  const sheetRows = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => v === "" ? "" : typeof v === "number" ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="s"><v>${idx(v)}</v></c>`).join("")}</row>`).join("");
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return zip({
    "xl/workbook.xml": '<workbook xmlns:r="x"><sheets><sheet name="Staff &amp; roles" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/sharedStrings.xml": `<sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`.replace("<sst></sst>", "<sst/>"),
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
  });
};
test("an .xlsx is read as rows of text; blanks stay blank, numbers and entities come through", () => {
  const rows = [["Title row", "", ""], ["STAFF", "ROLE", "Pay"], ["Ann & Co <x>", "Clerk", 1500000]];
  const { sheet, rows: got } = readXlsx(xlsx(rows));
  assert.equal(sheet, "Staff & roles");
  assert.deepEqual(got[0], ["Title row"]);
  assert.deepEqual(got[2], ["Ann & Co <x>", "Clerk", "1500000"]);
});

test("something that is not a spreadsheet is refused with a clear message", () => {
  assert.throws(() => readXlsx(Buffer.from("just some text, definitely not a zip file at all")), /Not an \.xlsx/);
});

// ---- the staff list ---------------------------------------------------------------------------
const header = [["ACME STAFF LIST 2026", "", "", "", ""], ["STAFF", "ROLE", "DEPARTMENT", "LINE MANAGER", ""]];
const staff = [
  ["Ada Okello", "Chief Executive Officer", "", "", "AC001"],
  ["Ben Mugisha", "Chief Financial Officer", "FINANCE", "MR. OKELLO", "AC 002"],
  ["Cara Nsubuga", "Senior Accountant", "FINANCE", "BEN MUGISHA", "AC003"],
  ["Dan Kato ", "Accountant", "FINANCE", "CARA NSUBUGA", "AC004"],
  ["Eve Namatovu", "Clerk", "FINANCE", "SENIOR ACCOUNTANT", "AC005"],            // a job title, not a name
  ["Finn Lubega", "Clerk", "FINANCE", "MR. MUGISHA/ MS. NSUBUGA", "AC006"],       // two managers
  ["Gus Kiggundu", "Clerk", "OPERATIONS", "VACANT HEAD", "AC007"],                // matches nobody
  ["Hope Kiggundu", "Clerk", "OPERATIONS", "GUS KIGGUNDU", "AC008"],
  ["Ivy Ssali", "Clerk", "OPERATIONS", "KIGGUNDU", "AC009"],                       // two people called Kiggundu
  ["Jon Baker", "Driver", "OPERATIONS", "ADA OKELLO", ""],                         // no employee number
  ["Kim Baker", "Driver", "OPERATIONS", "ADA OKELLO", "AC002"],                    // number used twice
  ["Lee Fox", "Chief Chaaaief", "OPERATIONS", "LEE FOX", "AC010"],                 // reports to themself, typo title
];
const run = () => analyse([...header, ...staff], { org: "Acme" });
const by = (r, no) => r.people.find((p) => p.no === no);

test("employee numbers are tidied; someone with none gets a temporary one; a repeated one is left out and reported", () => {
  const r = run();
  assert.equal(by(r, "AC002").name, "Ben Mugisha", "'AC 002' becomes AC002 and the first holder keeps it");
  const jon = r.people.find((p) => p.name === "Jon Baker");
  assert.equal(jon.no, "TEMP-001", "no number: loaded under a temporary one, not lost");
  assert.ok(r.notes.some((n) => n.kind === "provisional" && /Jon Baker/.test(n.text) && /TEMP-001/.test(n.text)));
  assert.match(r.import, /^TEMP-001,Jon Baker,/m);
  assert.ok(!r.people.some((p) => p.name === "Kim Baker"), "a repeated number: only the first is imported");
  assert.ok(r.notes.some((n) => n.kind === "duplicate" && /AC002/.test(n.text)));
  assert.equal(by(r, "AC004").name, "Dan Kato", "trailing spaces are removed");
});

test("line managers are matched by name, by title, or left empty and reported: never guessed", () => {
  const r = run();
  assert.equal(by(r, "AC002").headNo, "AC001", "'MR. OKELLO' is Ada Okello");
  assert.equal(by(r, "AC003").headNo, "AC002");
  assert.equal(by(r, "AC005").headNo, "AC003", "a unique job title names the manager");
  assert.ok(r.notes.some((n) => n.kind === "assumed" && /Eve Namatovu/.test(n.text)), "a title match is flagged for confirmation");
  assert.equal(by(r, "AC006").headNo, "AC002", "two managers: the first is used and it is flagged");
  assert.ok(r.notes.some((n) => n.kind === "dual" && /Finn Lubega/.test(n.text)));
  assert.equal(by(r, "AC007").headNo, null);
  assert.ok(r.notes.some((n) => n.kind === "unresolved" && /Gus Kiggundu/.test(n.text)));
  assert.equal(by(r, "AC009").headNo, null, "two people could be meant: nobody is chosen");
  assert.ok(r.notes.some((n) => n.kind === "ambiguous" && /Ivy Ssali/.test(n.text)));
  assert.equal(by(r, "AC010").headNo, null, "nobody is their own manager");
});

test("the import file has the columns Wola's importer needs, no commas inside values, and blanks where the sheet had no data", () => {
  const lines = run().import.trim().split("\n");
  assert.equal(lines[0], "employee_no,full_name,department,department_head_no,title,gross_salary,net_salary,is_post_probation,on_final_warning,work_email,review_note,status");
  for (const l of lines) assert.equal(l.split(",").length, 12, `every row has twelve cells: ${l}`);
  const ben = lines.find((l) => l.startsWith("AC002,"));
  assert.equal(ben, "AC002,Ben Mugisha,Finance,AC001,Chief Financial Officer,,,,false,,,active");
  const ada = lines.find((l) => l.startsWith("AC001,"));
  assert.match(ada, /,Executive,/, "a missing department is filled in and flagged, not left empty");
});

test("salaries and probation come through when the sheet has them", () => {
  const rows = [["STAFF", "ROLE", "DEPARTMENT", "LINE MANAGER", "ID", "GROSS PAY", "NET PAY", "PAST PROBATION"],
    ["Ann Lee", "Clerk", "HR", "", "X1", "2,500,000", "2000000", "Yes"], ["Bo Ng", "Clerk", "HR", "ANN LEE", "X2", "", "abc", "no"]];
  const r = analyse(rows);
  assert.match(r.import, /X1,Ann Lee,Hr,,Clerk,2500000,2000000,true,false/);
  assert.match(r.import, /X2,Bo Ng,Hr,X1,Clerk,,,false,false/);
  assert.ok(r.notes.some((n) => n.kind === "salary" && /Bo Ng/.test(n.text)), "a salary that is not a number is reported, not imported as junk");
});

test("roles are suggested from titles and reporting lines, and the review says which approvers are missing", () => {
  const r = run();
  const role = (no) => r.roles.find((x) => x.no === no).role;
  assert.equal(role("AC001"), "ceo"); assert.equal(role("AC002"), "cfo");
  assert.equal(role("AC003"), "dept_head", "manages others");
  assert.equal(role("AC004"), "employee");
  assert.match(r.review, /group_ceo/, "the review warns that nobody can approve when the CEO applies");
  assert.match(r.review, /Staff list review: Acme/);
});

test("it finds the header row and an unlabelled employee-number column by itself", () => {
  const { cols } = mapColumns([...header, ...staff]);
  assert.equal(cols.id, 4);
  assert.throws(() => mapColumns([["a", "b"], ["c", "d"]]), /header row/);
  assert.equal(titleCase("PEOPLE & STRATEGY"), "People & Strategy");
});

test("a reporting line that loops is reported", () => {
  const rows = [["STAFF", "ROLE", "DEPARTMENT", "LINE MANAGER", "ID"], ["Pat One", "Lead", "A", "SAM TWO", "P1"], ["Sam Two", "Lead", "A", "PAT ONE", "P2"]];
  assert.ok(analyse(rows).notes.some((n) => n.kind === "cycle"));
});

test("the two awkward cases MUA has are written into the file as notes HR will see on the dashboard", () => {
  const r = run();
  const row = (no) => r.import.trim().split(String.fromCharCode(10)).find((l) => l.startsWith(no + ","));
  assert.match(row("AC007"), /matches nobody in the staff list/, "a line manager that matches nobody");
  assert.match(row("AC006"), /two line managers/, "two managers");
  assert.equal(by(r, "AC006").headNo, "AC002");
  assert.match(row("AC001"), /,false,,,active$/, "a clean row has no note");
  const dual = analyse([["STAFF", "ROLE", "DEPARTMENT", "LINE MANAGER", "ID"], ["Pat Lee", "Credit Controller", "COMMERCIAL/FINANCE", "", "Q1"]]);
  assert.match(dual.import, /^Q1,Pat Lee,Commercial,,Credit Controller,.*Listed in two departments \(Commercial and Finance\)/m, "two departments: the first is used and the note says so");
});

test("the temporary-number prefix is the same one the app uses", async () => {
  const { PROVISIONAL_EMPLOYEE_NO_PREFIX } = await import("../../engine/src/employee-no.ts");
  assert.equal(PROVISIONAL_EMPLOYEE_NO_PREFIX, "TEMP-");
  assert.match(run().import, new RegExp(`^${PROVISIONAL_EMPLOYEE_NO_PREFIX}001,`, "m"));
});

// ---- an HR export (emails, status, joined date) merged with a separate line-manager list --------------------
const hris = [
  ["Employee ID", "Full Name", "Email", "Department", "Job Title", "Status", "Joined Date", "QR Generated At"],
  ["AC001", "Ada Okello", "aokello@acme.test", "Executive", "Chief Executive Officer", "active", "2024-01-01", "x"],
  ["AC 002", "Ben Mugisha", "bmugisha@acme.test", "Finance", "Chief Financial Officer", "active", "2024-01-01", "x"],
  ["AC003", "Cara Nsubuga", "cnsubuga@acme.test", "Finance", "Senior Accountant", "suspended", "2024-01-01", "x"],
  ["ACME/FTC004", "Dan Kato", "dkato@acme.test", "Finance", "Accountant ", "active", "2026-09-01", "x"],
  ["AC005", "Eve Namatovu", "enamatovu@gmail.test", "Finance", "Driver", "active", "2025-01-10", "x"],
  ["AC006", "Fay Gone", "fgone@acme.test", "Finance", "Clerk", "left", "2024-01-01", "x"],
  ["AC007", "New Joiner", "njoiner@acme.test", "Finance", "Clerk", "active", "2026-10-01", "x"],
];
const managers = [
  ["STAFF", "ROLE", "DEPARTMENT", "LINE MANAGER", ""],
  ["Ada Okello", "Chief Executive Officer", "", "", "AC001"],
  ["Ben Mugisha", "Chief Financial Officer", "FINANCE", "MR. OKELLO", "AC002"],
  ["Cara Nsubuga", "Senior Accountant", "FINANCE", "BEN MUGISHA", "AC003"],
  ["Dan Kato", "Accountant", "FINANCE", "CARA NSUBUGA", ""],          // no number in this list: matched by name
  ["Eve Namatovu", "Driver", "FINANCE", "BEN MUGISHA", "AC005"],
  ["Old Hand", "Clerk", "FINANCE", "BEN MUGISHA", "AC099"],           // in the manager list only
];

test("an HR export is the main source; the manager list is merged in by number, then by name", () => {
  const r = analyse(hris, { org: "Acme", managerRows: managers, practice: false });
  const p = (no) => r.people.find((x) => x.no === no);
  assert.equal(r.people.length, 6, "the person marked as having left is not loaded");
  assert.ok(!r.people.some((x) => x.name === "Fay Gone"));
  assert.equal(p("AC002").email, "bmugisha@acme.test", "emails come from the HR export");
  assert.equal(p("ACME/FTC004").headNo, "AC003", "matched to the manager list by name when the number differs");
  assert.equal(p("AC002").headNo, "AC001");
  assert.equal(p("AC005").headNo, "AC002");
  assert.ok(r.notes.some((n) => /Old Hand/.test(n.text) && /not in the main staff list/.test(n.text)), "someone only in the manager list is reported, not loaded");
  const nm = r.notes.filter((n) => n.kind === "nomanager").map((n) => n.who);
  assert.deepEqual(nm, ["New Joiner"], "a person with no manager on file is flagged; the CEO needs none");
  assert.match(r.import, /^AC007,New Joiner,.*No line manager on file/m, "and the flag is written into the file for the HR dashboard");
});

test("suspended staff are loaded as suspended and never suggested for a role; an FTC number is kept as given", () => {
  const r = analyse(hris, { managerRows: managers });
  assert.match(r.import, /^AC003,Cara Nsubuga,.*,suspended$/m);
  assert.equal(r.roles.find((x) => x.no === "AC003").role, "employee", "even though she manages Dan");
  assert.match(r.roles.find((x) => x.no === "AC003").why, /suspended/i);
  assert.match(r.import, /^ACME\/FTC004,Dan Kato,/m, "a number with a slash survives");
  assert.equal(r.people.find((x) => x.no === "ACME/FTC004").title, "Accountant", "trailing space removed");
});

test("practice pay: invented, deterministic, scaled by seniority; recent joiners and fixed-term staff are on probation", () => {
  const today = new Date("2026-10-14T00:00:00Z");
  const a = analyse(hris, { managerRows: managers, practice: true, today }), b = analyse(hris, { managerRows: managers, practice: true, today });
  assert.equal(a.import, b.import, "the same input gives the same figures");
  const p = (no) => a.people.find((x) => x.no === no);
  assert.ok(p("AC001").gross > p("AC002").gross && p("AC002").gross > p("AC003").gross && p("AC003").gross > p("AC005").gross, "CEO > chief > senior > driver");
  for (const x of a.people) { assert.ok(x.net < x.gross && x.net > 0.7 * x.gross); assert.equal(x.gross % 50_000, 0); }
  assert.equal(p("AC001").postProbation, true);
  assert.equal(p("ACME/FTC004").postProbation, false, "fixed-term and joined within six months");
  assert.equal(p("AC007").postProbation, false, "joined two weeks ago");
  assert.match(a.review, /PRACTICE PAY/);
  assert.doesNotMatch(analyse(hris, { managerRows: managers }).review, /PRACTICE PAY/, "and only when asked for");
  assert.match(analyse(hris, { managerRows: managers }).import, /^AC001,Ada Okello,Executive,,Chief Executive Officer,,,,false,/m, "without --practice-pay, pay stays blank");
});

test("an email on a different domain from everyone else's is flagged, and a job title with punctuation still matches", () => {
  const rows = [
    ["Employee ID", "Full Name", "Email", "Department", "Job Title", "Status"],
    ["AC1", "Ann Boss", "aboss@acme.test", "Exec", "Chief Executive Officer", "active"],
    ["AC2", "Bo Lee", "blee@acme.test", "Ops", "Senior Accountant-Reporting", "active"],
    ["AC3", "Cy Ng", "cyng@acme.test", "Ops", "Clerk", "active"],
    ["AC4", "Di Fox", "difox@gmail.test", "Ops", "Clerk", "active"],
  ];
  const mgrs = [["STAFF", "ROLE", "DEPARTMENT", "LINE MANAGER", ""], ["Ann Boss", "CEO", "", "", "AC1"], ["Bo Lee", "x", "", "ANN BOSS", "AC2"], ["Cy Ng", "x", "", "SENIOR ACCOUNTANT REPORTING", "AC3"], ["Di Fox", "x", "", "ANN BOSS", "AC4"]];
  const r = analyse(rows, { managerRows: mgrs });
  assert.equal(r.people.find((p) => p.no === "AC3").headNo, "AC2", "'Senior Accountant-Reporting' = 'SENIOR ACCOUNTANT REPORTING'");
  const flagged = r.notes.filter((n) => n.kind === "email");
  assert.equal(flagged.length, 1);
  assert.match(flagged[0].text, /Di Fox.*gmail\.test.*acme\.test/);
  assert.match(r.import, /^AC4,Di Fox,.*Email is on @gmail\.test/m, "and the flag travels in the file to the HR dashboard");
});
