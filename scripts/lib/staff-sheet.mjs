// The same prefix as PROVISIONAL_EMPLOYEE_NO_PREFIX in packages/engine/src/employee-no.ts (a test keeps them equal).
// Duplicated here because this file runs as plain Node, which cannot import the TypeScript source.
const PROVISIONAL_EMPLOYEE_NO_PREFIX = "TEMP-";

// scripts/lib/staff-sheet.mjs: turn a client's staff list (names, roles, departments, line
// managers) into what Wola can import, and say plainly what a person still has to decide.
// Pure functions, no files and no database, so they are easy to test and to re-run when the
// client sends a corrected list. Nothing here guesses silently: every assumption becomes a note.

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const normId = (s) => clean(s).replace(/\s+/g, "").toUpperCase(); // "MUA 029" -> "MUA029"
const ID_LIKE = /^[A-Za-z]{2,}-?\d{1,}$/;
const TITLE_PREFIX = /^(MR|MS|MRS|MISS|DR|ENG|PROF)\.?\s+/i;

const small = new Set(["and", "of", "the", "for", "&"]);
export const titleCase = (s) =>
  clean(s).toLowerCase().replace(/[^\s/-]+/g, (w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)));

/** Find the header row and map the columns we care about. */
export function mapColumns(rows) {
  const at = rows.findIndex((r) => r.some((c) => /^(staff|name|employee|full name)$/i.test(clean(c))) && r.some((c) => /role|title|position/i.test(clean(c))));
  if (at < 0) throw new Error('Could not find the header row. Expected columns like "STAFF", "ROLE", "DEPARTMENT", "LINE MANAGER".');
  const head = rows[at].map(clean);
  const find = (re) => head.findIndex((h) => re.test(h));
  const cols = {
    name: find(/^(staff|name|employee|full name)$/i),
    role: find(/role|title|position/i),
    dept: find(/dept|department/i),
    manager: find(/manager|reports? to|supervisor/i),
    id: find(/^(id|no\.?|number|employee (no|number|id)|staff (no|number|id)|emp(loyee)? ?(no|id))$/i),
    gross: find(/gross/i),
    net: find(/\bnet\b|take.?home/i),
    probation: find(/probation/i),
    email: find(/e-?mail/i),
  };
  const body = rows.slice(at + 1).filter((r) => r.some((c) => clean(c)));
  if (cols.id < 0) {
    // The ID column is often unlabelled: pick the column whose values look like "MUA009".
    const width = Math.max(...body.map((r) => r.length), head.length);
    let best = -1, bestHits = 0;
    for (let c = 0; c < width; c++) {
      if (Object.values(cols).includes(c)) continue;
      const hits = body.filter((r) => ID_LIKE.test(normId(r[c]))).length;
      if (hits > bestHits) { best = c; bestHits = hits; }
    }
    if (best >= 0 && bestHits >= body.length / 2) cols.id = best;
  }
  if (cols.name < 0 || cols.id < 0) throw new Error("Could not find the staff-name column or the employee-number column.");
  return { cols, body, headerRow: at + 1 };
}

const num = (s) => { const t = clean(s).replace(/[, ]/g, ""); return t === "" ? null : Number.isFinite(Number(t)) ? Number(t) : NaN; };
const yes = (s) => /^(y|yes|true|1|confirmed|post)/i.test(clean(s));

/** People from the sheet, tidied. Notes are things changed or left out, in plain words. */
export function parsePeople(rows) {
  const { cols, body, headerRow } = mapColumns(rows);
  const notes = [], people = [], seen = new Map();
  body.forEach((r, i) => {
    const sheetRow = headerRow + i + 1;
    const name = clean(r[cols.name]);
    if (!name) return;
    const raw = clean(r[cols.id]);
    const no = normId(raw);
    const provisional = !no; // no number in the sheet: given a temporary one below, so the person is not lost
    if (raw !== no) notes.push({ kind: "tidied", who: name, text: `Employee number "${raw}" written as ${no}.` });
    if (!provisional && seen.has(no)) { notes.push({ kind: "duplicate", who: name, text: `${no} appears twice (${seen.get(no)} and ${name}). Only the first is imported; ask HR which is right.` }); return; }
    if (!provisional) seen.set(no, name);
    if (r[cols.name] !== name) notes.push({ kind: "tidied", who: name, text: `Extra spaces removed from the name "${clean(r[cols.name])}".` });
    const title = cols.role >= 0 ? clean(r[cols.role]) : "";
    if (/(.)\1\1/i.test(title)) notes.push({ kind: "typo", who: name, text: `The job title "${title}" looks like a typo (a letter repeated three times). Imported as written.` });
    const gross = cols.gross >= 0 ? num(r[cols.gross]) : null, net = cols.net >= 0 ? num(r[cols.net]) : null;
    if (Number.isNaN(gross) || Number.isNaN(net)) notes.push({ kind: "salary", who: name, text: `${name}: a salary figure is not a number. Left blank.` });
    people.push({
      row: sheetRow, no, name, title, provisional, reviewNotes: [],
      department: cols.dept >= 0 ? clean(r[cols.dept]) : "",
      managerRaw: cols.manager >= 0 ? clean(r[cols.manager]) : "",
      gross: Number.isFinite(gross) ? gross : null, net: Number.isFinite(net) ? net : null,
      postProbation: cols.probation >= 0 ? yes(r[cols.probation]) : null,
      email: cols.email >= 0 ? clean(r[cols.email]).toLowerCase() : "",
      headNo: null, headName: null,
    });
  });
  // Temporary numbers (TEMP-001, ...) for anyone the sheet gave none. Wola shows HR a warning on the
  // dashboard until the real number is entered; they are never confused with real numbers.
  let seq = 0;
  for (const p of people.filter((q) => q.provisional)) {
    do { seq++; p.no = `${PROVISIONAL_EMPLOYEE_NO_PREFIX}${String(seq).padStart(3, "0")}`; } while (seen.has(p.no));
    seen.set(p.no, p.name);
    notes.push({ kind: "provisional", who: p.name, text: `${p.name} has no employee number in the sheet. Loaded as ${p.no}; Wola warns HR on the dashboard until the real number is entered.` });
  }
  for (const p of people) {
    const pretty = p.department ? titleCase(p.department) : "";
    if (!p.department) notes.push({ kind: "assumed", who: p.name, text: `${p.name} (${p.title || "no title"}) has no department. Entered as "Executive"; change it if that is wrong.` });
    p.department = pretty || "Executive";
    if (p.department.includes("/")) {
      const parts = p.department.split("/").map(clean);
      notes.push({ kind: "dual", who: p.name, text: `${p.name} is in two departments ("${p.department}"). Wola holds one; loaded under ${parts[0]}. Confirm.` });
      p.reviewNotes.push(`Listed in two departments (${parts.join(" and ")}); loaded under ${parts[0]}. Confirm which is right.`);
      p.department = parts[0];
    }
  }
  return { people, notes, cols };
}

const words = (s) => clean(s).replace(TITLE_PREFIX, "").split(/[\s.]+/).map((w) => w.toUpperCase()).filter((w) => w.length > 1);
const matchesName = (refWords, person) => {
  const nameWords = clean(person.name).toUpperCase().split(/\s+/);
  // every word of the reference must be a whole word, or the start of a word (3+ letters), of the name
  return refWords.length > 0 && refWords.every((rw) => nameWords.some((nw) => nw === rw || (rw.length >= 3 && nw.startsWith(rw))));
};

/** Work out who each person's line manager is. A reference that matches nobody, or more than one
 *  person, is left empty and reported: a wrong department head would send loan approvals to the wrong person. */
export function resolveManagers(people, notes = []) {
  const byTitle = new Map();
  for (const p of people) { const k = clean(p.title).toLowerCase(); if (k) byTitle.set(k, [...(byTitle.get(k) ?? []), p]); }
  for (const p of people) {
    p.headNo = null; p.headName = null;
    if (!p.managerRaw) continue;
    const parts = p.managerRaw.split("/").map(clean).filter(Boolean);
    let chosen = null;
    for (const part of parts) {
      const rw = words(part);
      const hits = people.filter((q) => q !== p && matchesName(rw, q));
      if (hits.length === 1) { chosen = { who: hits[0], via: "name", part }; break; }
      const byRole = byTitle.get(part.toLowerCase()) ?? [];
      if (byRole.length === 1 && byRole[0] !== p) { chosen = { who: byRole[0], via: "title", part }; break; }
      if (hits.length > 1) {
        notes.push({ kind: "ambiguous", who: p.name, text: `${p.name}: line manager "${part}" could be ${hits.map((h) => h.name).join(" or ")}. Left empty until HR says which.` });
        p.reviewNotes.push(`Line manager "${part}" could be ${hits.map((h) => h.name).join(" or ")}. Set the department head.`);
      }
    }
    if (chosen) {
      p.headNo = chosen.who.no; p.headName = chosen.who.name;
      if (chosen.via === "title") notes.push({ kind: "assumed", who: p.name, text: `${p.name}: line manager "${chosen.part}" is a job title, matched to ${chosen.who.name}. Confirm.` });
      if (parts.length > 1) {
        notes.push({ kind: "dual", who: p.name, text: `${p.name} has two line managers ("${p.managerRaw}"). Wola holds one; used ${chosen.who.name}. Confirm which should approve their loans.` });
        p.reviewNotes.push(`Has two line managers ("${p.managerRaw}"); ${chosen.who.name} is set as department head. Confirm which should approve their loans.`);
      }
    } else if (!notes.some((n) => n.kind === "ambiguous" && n.who === p.name)) {
      notes.push({ kind: "unresolved", who: p.name, text: `${p.name}: line manager "${p.managerRaw}" matches nobody in the list (a vacant post, or someone missing from the sheet?). No department head set, so their loans cannot route to a head until it is fixed.` });
      p.reviewNotes.push(`Line manager "${p.managerRaw}" matches nobody in the staff list (a vacant post?). No department head set: choose one.`);
    }
  }
  // A chain that loops would leave nobody at the top to approve.
  const byNo = new Map(people.map((p) => [p.no, p]));
  for (const p of people) {
    const trail = new Set([p.no]);
    for (let q = byNo.get(p.headNo); q; q = byNo.get(q.headNo)) {
      if (trail.has(q.no)) {
        notes.push({ kind: "cycle", who: p.name, text: `The reporting line from ${p.name} loops back on itself at ${q.name}. Check the line managers.` });
        p.reviewNotes.push(`Reporting line loops back on itself at ${q.name}. Check the department head.`);
        break;
      }
      trail.add(q.no);
    }
  }
  return { people, notes };
}

const EXEC_ROLES = [
  [/chief executive|^ceo$|managing director/i, "ceo", "Head of the organisation"],
  [/chief financial|^cfo$|finance director/i, "cfo", "Head of finance"],
  [/chief operat|^coo$/i, "coo", "Head of operations"],
  [/chief people|head of (hr|human)|human resources? (manager|director)|^hr (manager|head)/i, "hr", "Head of people / HR"],
];

/** A suggestion for each person's Wola role. Only a suggestion: the client decides. */
export function suggestRoles(people) {
  const managers = new Set(people.map((p) => p.headNo).filter(Boolean));
  const out = [];
  for (const p of people) {
    let role = "employee", why = "Everyone else borrows as an employee.";
    const exec = EXEC_ROLES.find(([re]) => re.test(p.title));
    if (exec) { role = exec[1]; why = exec[2] + "."; }
    else if (/people operations|human resources|\bhr\b/i.test(p.title)) { role = "hr"; why = "Looks after people matters; HR verifies employment on an application."; }
    else if (/information systems|\bit (manager|lead)|systems administrator/i.test(p.title)) { role = "org_admin"; why = "Runs the systems; can set up users and settings (no loan approvals)."; }
    else if (managers.has(p.no)) { role = "dept_head"; why = `Is the line manager of ${people.filter((q) => q.headNo === p.no).length} people, so approves their loans first.`; }
    out.push({ no: p.no, name: p.name, title: p.title, role, why });
  }
  return out;
}

const COLUMNS = ["employee_no", "full_name", "department", "department_head_no", "title", "gross_salary", "net_salary", "is_post_probation", "on_final_warning", "work_email", "review_note"];
const cell = (v) => String(v ?? "").replace(/,/g, " ").replace(/[\r\n]+/g, " ").trim(); // the importer has no quoting

/** The file for Settings -> Employees -> Import. Salary and probation stay blank unless the sheet had them. */
export function importCsv(people) {
  const lines = [COLUMNS.join(",")];
  for (const p of people) {
    lines.push([p.no, p.name, p.department, p.headNo ?? "", p.title, p.gross ?? "", p.net ?? "", p.postProbation == null ? "" : p.postProbation ? "true" : "false", "false", p.email, p.reviewNotes.join(" ")].map(cell).join(","));
  }
  return lines.join("\n") + "\n";
}

export function accountsCsv(roles, people) {
  const email = new Map(people.map((p) => [p.no, p.email]));
  const lines = ["employee_no,full_name,title,work_email,suggested_role,why"];
  for (const r of roles) lines.push([r.no, r.name, r.title, email.get(r.no) ?? "", r.role, r.why].map(cell).join(","));
  return lines.join("\n") + "\n";
}

const PIPELINE_ROLES = ["dept_head", "hr", "cfo", "ceo", "coo", "group_ceo"];

/** A plain-language review the client's HR can act on. Names appear here: keep the file private. */
export function reviewMarkdown({ org, source, people, notes, roles }) {
  const by = (kind) => notes.filter((n) => n.kind === kind);
  const depts = new Map();
  for (const p of people) depts.set(p.department, (depts.get(p.department) ?? 0) + 1);
  const noSalary = people.filter((p) => p.gross == null || p.net == null).length;
  const noProb = people.filter((p) => p.postProbation == null).length;
  const roleCount = new Map();
  for (const r of roles) roleCount.set(r.role, (roleCount.get(r.role) ?? 0) + 1);
  const missingRoles = PIPELINE_ROLES.filter((r) => !roleCount.has(r));

  const L = [];
  L.push(`# Staff list review: ${org}`, "", `Source: ${source}. **Private: contains staff names. Do not commit or email around.**`, "");
  L.push("## In one minute", "");
  L.push(`- **${people.length} people** ready to load, in ${depts.size} departments.`);
  const toDecide = notes.filter((n) => ["provisional", "duplicate", "unresolved", "ambiguous", "cycle", "dual", "assumed", "typo"].includes(n.kind)).length;
  L.push(`- **${toDecide} thing${toDecide === 1 ? "" : "s"} for the client's HR to confirm or correct** (section 1).`);
  L.push(`- **Salaries: ${noSalary === people.length ? "none in the sheet" : `${people.length - noSalary} of ${people.length} present`}.** Wola needs gross and net monthly pay to work out how much someone may borrow. ${noSalary ? "Without them, nobody can borrow." : ""}`);
  L.push(`- **Probation status: ${noProb === people.length ? "not in the sheet" : "present for some"}.** A person who is not marked as past probation cannot borrow.`);
  L.push(`- **Work emails: ${people.some((p) => p.email) ? "some present" : "none in the sheet"}.** Everyone needs one to receive their invitation.`, "");

  const sec = (title, kinds, intro) => {
    const items = notes.filter((n) => kinds.includes(n.kind));
    L.push(`### ${title}`, "");
    if (intro) L.push(intro, "");
    if (!items.length) L.push("Nothing here.", "");
    else { for (const n of items) L.push(`- [ ] ${n.text}`); L.push(""); }
  };
  L.push("## 1. Decisions for the client's HR", "");
  sec("Missing or doubled employee numbers", ["provisional", "duplicate"]);
  sec("Line managers Wola could not work out", ["unresolved", "ambiguous", "cycle"], "A person's line manager is their **department head** in Wola: the first approver of their loans.");
  sec("Two managers or two departments", ["dual"]);
  sec("Assumptions made for you (confirm or correct)", ["assumed"]);
  sec("Possible typos", ["typo"]);

  L.push("## 2. Tidied automatically (no action)", "");
  const tidy = by("tidied");
  if (!tidy.length) L.push("Nothing needed tidying.", ""); else { for (const n of tidy) L.push(`- ${n.text}`); L.push(""); }

  L.push("## 3. Suggested Wola roles", "", "Only a suggestion, from job titles and who manages whom. The client decides.", "");
  L.push("| Role | People | Who |", "| --- | --- | --- |");
  for (const [role, n] of [...roleCount.entries()].sort((a, b) => a[1] - b[1])) {
    const who = roles.filter((r) => r.role === role).map((r) => r.name);
    L.push(`| ${role} | ${n} | ${n <= 6 ? who.join(", ") : "everyone else listed in accounts.csv"} |`);
  }
  L.push("");
  if (missingRoles.length) L.push(`**The approval chains need someone in: ${missingRoles.join(", ")}.** Nobody was suggested for ${missingRoles.length > 1 ? "these" : "this"}. ${missingRoles.includes("group_ceo") ? "(`group_ceo` approves when the CEO themselves applies for a loan: ask who sits above the CEO.) " : ""}`, "");

  L.push("## 4. Departments", "", "| Department | People |", "| --- | --- |");
  for (const [d, n] of [...depts.entries()].sort((a, b) => b[1] - a[1])) L.push(`| ${d} | ${n} |`);
  L.push("", "## 5. Still needed from the client before anyone can borrow", "");
  L.push("1. Monthly **gross and net pay** for each person (from payroll), and whether each is **past probation**.");
  L.push("2. A **work email** for each person.");
  L.push("3. Answers to section 1 above.");
  L.push("4. Their **running loans** (borrower, product, amount, rate, start date, term, repaid so far) if staff already have loans to bring across.");
  return L.join("\n") + "\n";
}

/** Everything in one call, for the command and the tests. */
export function analyse(rows, { org = "the organisation", source = "the staff list" } = {}) {
  const parsed = parsePeople(rows);
  const { people, notes } = resolveManagers(parsed.people, parsed.notes);
  const roles = suggestRoles(people);
  return { people, notes, roles, import: importCsv(people), accounts: accountsCsv(roles, people), review: reviewMarkdown({ org, source, people, notes, roles }) };
}
