// scripts/setup-mua-tenant.mjs — provisions a dedicated 'mua' tenant for the
// MUA Insurance demo, seeded with:
//   1. MUA's REAL confirmed benefit-scheme loan products (copied verbatim
//      from seed-dev.sql's testco UPDATE statements — these numbers were
//      confirmed with MUA HR per DECISIONS.md, this isn't new config).
//   2. The same approval pipeline structure as testco (dept_head->hr->cfo->ceo,
//      plus the CEO-applying special routes).
//   3. The real 47-person staff list from the CSV, with:
//      - employee_no from the MUA ID column
//      - department_head resolved by NAME-MATCHING against the LINE MANAGER
//        column (which contains names/partial names, not employee_nos —
//        the CSV format the app's own CSV importer expects). Unresolved
//        matches are left null rather than guessed.
//      - synthetic salaries scaled by a seniority tier inferred from the
//        role title (no real payroll data was provided).
//
// Usage:
//   node --import dotenv/config scripts/setup-mua-tenant.mjs --dry-run   (review only, writes nothing)
//   node --import dotenv/config scripts/setup-mua-tenant.mjs             (apply)
import postgres from "postgres";
import { readFileSync } from "node:fs";
import "dotenv/config";

const DRY_RUN = process.argv.includes("--dry-run");
const CSV_PATH = process.argv[2] && !process.argv[2].startsWith("--")
  ? process.argv[2]
  : "C:/Users/jmagero/Downloads/UPDATED STAFF LIST WITH ID NUMBERS & ROLES AS OF 1ST MARCH 2026(Sheet1).csv";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) { console.error("DATABASE_ADMIN_URL required"); process.exit(1); }
const sql = postgres(url, { max: 1 });

const TENANT_SLUG = "mua";
const TENANT_NAME = "MUA Insurance";

// ---- parse the CSV ---------------------------------------------------------
const raw = readFileSync(CSV_PATH, "utf8");
const lines = raw.split(/\r\n|\n/).filter((l) => l.trim().length > 0);
// Row 1 is a title line, row 2 is the real header.
const dataLines = lines.slice(2);

const rows = dataLines.map((line) => {
  const cells = line.split(",");
  return {
    staff: (cells[0] ?? "").trim(),
    role: (cells[1] ?? "").trim(),
    department: (cells[2] ?? "").trim(),
    lineManager: (cells[3] ?? "").trim(),
    idRaw: (cells[4] ?? "").trim(),
  };
}).filter((r) => r.staff && r.idRaw);

const normalizeId = (s) => s.replace(/\s+/g, "").toUpperCase(); // "MUA 029" -> "MUA029"
for (const r of rows) r.employeeNo = normalizeId(r.idRaw);

// ---- salary tier by role keyword (SYNTHETIC — no real payroll provided) ---
function salaryFor(role) {
  const words = role.toLowerCase().split(/\s+/);
  const has = (...kw) => kw.some((k) => words.includes(k));
  if (role.toLowerCase().includes("chief executive")) return { gross: 35_000_000, net: 28_000_000 };
  if (has("chief")) return { gross: 25_000_000, net: 20_000_000 };
  // Word-boundary check, not substring — "Team Leader" must not match "Lead".
  if (has("manager", "deputy", "lead", "leader", "senior")) return { gross: 10_000_000, net: 8_000_000 };
  if (has("assistant", "support", "driver")) return { gross: 2_800_000, net: 2_300_000 };
  return { gross: 5_500_000, net: 4_500_000 }; // officer/specialist/accountant/underwriter/analyst/etc — default mid tier
}

// ---- name matching: LINE MANAGER (a name, inconsistently formatted) ->
// employee_no. Strip title prefixes, then require every remaining
// significant word in the reference to appear in a candidate's full name. ---
const TITLE_PREFIX = /^(MR\.?|MS\.?|MRS\.?)\s+/i;
function significantWords(name) {
  return name
    .replace(TITLE_PREFIX, "")
    .split(/\s+/)
    .map((w) => w.toUpperCase())
    .filter((w) => w.length > 1); // drop single-letter abbreviations like the "S" in "EVELYN LWANGA S"
}

function resolveManager(lineManagerRaw, allRows) {
  if (!lineManagerRaw) return null;
  const refWords = significantWords(lineManagerRaw);
  if (refWords.length === 0) return null;

  const candidates = allRows.filter((r) => {
    const nameWords = r.staff.toUpperCase().split(/\s+/);
    return refWords.every((rw) => nameWords.some((nw) => nw.startsWith(rw) || rw.startsWith(nw)));
  });
  if (candidates.length === 1) return candidates[0];
  return null; // ambiguous or no match — leave unresolved rather than guess
}

for (const r of rows) {
  const match = resolveManager(r.lineManager, rows);
  r.resolvedManager = match ? match.employeeNo : null;
  r.resolvedManagerName = match ? match.staff : null;
}

// ---- dry-run report ---------------------------------------------------------
console.log(`Parsed ${rows.length} employees.\n`);
console.log("employee_no | staff                       | role                                     | dept              | line manager (raw)        -> resolved");
console.log("-".repeat(160));
let unresolved = 0;
for (const r of rows) {
  const sal = salaryFor(r.role);
  if (r.lineManager && !r.resolvedManager) unresolved++;
  console.log(
    `${r.employeeNo.padEnd(11)} | ${r.staff.padEnd(27)} | ${r.role.padEnd(40)} | ${r.department.padEnd(17)} | ${r.lineManager.padEnd(26)} -> ${r.resolvedManager ?? "(unresolved)"} ${r.resolvedManagerName ? "(" + r.resolvedManagerName + ")" : ""}  [salary: ${sal.gross.toLocaleString()}]`,
  );
}
console.log(`\n${unresolved} line-manager reference(s) left unresolved (shown above) — will import with no department head link.`);

if (DRY_RUN) {
  console.log("\n--dry-run: nothing written. Re-run without --dry-run to apply.");
  await sql.end();
  process.exit(0);
}

// ---- apply --------------------------------------------------------------
console.log("\nApplying...");

const [tenant] = await sql`
  INSERT INTO tenants (slug, name, status) VALUES (${TENANT_SLUG}, ${TENANT_NAME}, 'active')
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING id`;
const T = tenant.id;
console.log("tenant:", TENANT_NAME, T);

// Loan products — names/kinds first, then the real confirmed benefit-scheme
// parameters (verbatim from seed-dev.sql's testco config).
const productDefs = [
  { name: "Salary Advance", kind: "advance" },
  { name: "Development Loan", kind: "term" },
  { name: "Staff Car Loan", kind: "asset" },
];
for (const p of productDefs) {
  await sql`
    INSERT INTO loan_products (tenant_id, name, kind) VALUES (${T}, ${p.name}, ${p.kind})
    ON CONFLICT (tenant_id, name) DO NOTHING`;
}

await sql`
  UPDATE loan_products SET
    cap_method = 'salary_multiple', cap_basis = 'gross', cap_multiple = 1,
    max_tenor_months = 3, interest_applies = false,
    requires_post_probation = true, blocked_by_final_warning = true,
    requires_external_declaration = false
  WHERE kind = 'advance' AND tenant_id = ${T}`;

await sql`
  UPDATE loan_products SET
    cap_method = 'salary_multiple', cap_basis = 'gross', cap_multiple = 3,
    max_tenor_months = 36, interest_applies = true,
    requires_post_probation = true, blocked_by_final_warning = true,
    requires_external_declaration = false
  WHERE kind = 'term' AND tenant_id = ${T}`;

await sql`
  UPDATE loan_products SET
    cap_method = 'takehome_factor', cap_basis = 'net',
    takehome_factor = 0.4, takehome_multiplier = 30,
    max_tenor_months = 36, interest_applies = true,
    requires_post_probation = true, blocked_by_final_warning = true,
    requires_external_declaration = true
  WHERE kind = 'asset' AND tenant_id = ${T}`;

await sql`
  INSERT INTO product_exclusions (tenant_id, loan_product_id, excludes_product_id, reason)
  SELECT car.tenant_id, car.id, dev.id, 'Benefit scheme: no concurrent car and development loan'
  FROM loan_products car JOIN loan_products dev ON dev.tenant_id = car.tenant_id AND dev.kind = 'term'
  WHERE car.kind = 'asset' AND car.tenant_id = ${T}
  ON CONFLICT DO NOTHING`;
await sql`
  INSERT INTO product_exclusions (tenant_id, loan_product_id, excludes_product_id, reason)
  SELECT dev.tenant_id, dev.id, car.id, 'Benefit scheme: no concurrent car and development loan'
  FROM loan_products dev JOIN loan_products car ON car.tenant_id = dev.tenant_id AND car.kind = 'asset'
  WHERE dev.kind = 'term' AND dev.tenant_id = ${T}
  ON CONFLICT DO NOTHING`;
console.log("loan products + benefit-scheme rules seeded");

// Approval pipelines — default chain + CEO-applying special routes.
await sql`
  INSERT INTO approval_pipelines (tenant_id, loan_product_id, applies_to)
  SELECT ${T}, id, 'default' FROM loan_products WHERE tenant_id = ${T}
  ON CONFLICT (tenant_id, loan_product_id, applies_to) DO NOTHING`;
await sql`
  INSERT INTO approval_stages (tenant_id, pipeline_id, position, approver_role)
  SELECT p.tenant_id, p.id, v.position, v.role
  FROM approval_pipelines p CROSS JOIN (VALUES (1,'dept_head'),(2,'hr'),(3,'cfo'),(4,'ceo')) AS v(position, role)
  WHERE p.tenant_id = ${T} AND p.applies_to = 'default'
  ON CONFLICT (tenant_id, pipeline_id, position) DO NOTHING`;

await sql`
  INSERT INTO approval_pipelines (tenant_id, loan_product_id, applies_to)
  SELECT ${T}, lp.id, 'ceo' FROM loan_products lp WHERE lp.tenant_id = ${T} AND lp.kind = 'advance'
  ON CONFLICT (tenant_id, loan_product_id, applies_to) DO NOTHING`;
await sql`
  INSERT INTO approval_stages (tenant_id, pipeline_id, position, approver_role)
  SELECT p.tenant_id, p.id, v.position, v.role
  FROM approval_pipelines p JOIN loan_products lp ON lp.id = p.loan_product_id
  CROSS JOIN (VALUES (1,'hr'),(2,'cfo'),(3,'coo')) AS v(position, role)
  WHERE p.tenant_id = ${T} AND p.applies_to = 'ceo' AND lp.kind = 'advance'
  ON CONFLICT (tenant_id, pipeline_id, position) DO NOTHING`;

await sql`
  INSERT INTO approval_pipelines (tenant_id, loan_product_id, applies_to)
  SELECT ${T}, lp.id, 'ceo' FROM loan_products lp WHERE lp.tenant_id = ${T} AND lp.kind IN ('term','asset')
  ON CONFLICT (tenant_id, loan_product_id, applies_to) DO NOTHING`;
await sql`
  INSERT INTO approval_stages (tenant_id, pipeline_id, position, approver_role)
  SELECT p.tenant_id, p.id, v.position, v.role
  FROM approval_pipelines p JOIN loan_products lp ON lp.id = p.loan_product_id
  CROSS JOIN (VALUES (1,'hr'),(2,'cfo'),(3,'coo'),(4,'group_ceo')) AS v(position, role)
  WHERE p.tenant_id = ${T} AND p.applies_to = 'ceo' AND lp.kind IN ('term','asset')
  ON CONFLICT (tenant_id, pipeline_id, position) DO NOTHING`;
console.log("approval pipelines seeded");

// Employees — phase 1: upsert every row without department_head_id.
for (const r of rows) {
  const sal = salaryFor(r.role);
  await sql`
    INSERT INTO employees
      (tenant_id, employee_no, full_name, department, title, gross_salary, net_salary, is_post_probation)
    VALUES (${T}, ${r.employeeNo}, ${r.staff}, ${r.department || null}, ${r.role || null}, ${sal.gross}, ${sal.net}, true)
    ON CONFLICT (tenant_id, employee_no) DO UPDATE SET
      full_name = EXCLUDED.full_name, department = EXCLUDED.department, title = EXCLUDED.title,
      gross_salary = EXCLUDED.gross_salary, net_salary = EXCLUDED.net_salary, updated_at = now()`;
}
// Phase 2: resolve department_head_id now that every row exists.
for (const r of rows) {
  if (!r.resolvedManager) continue;
  await sql`
    UPDATE employees SET department_head_id = (
      SELECT id FROM employees WHERE tenant_id = ${T} AND employee_no = ${r.resolvedManager}
    )
    WHERE tenant_id = ${T} AND employee_no = ${r.employeeNo}`;
}
console.log(`${rows.length} employees imported`);

await sql.end();
console.log("\nDone. CEO (Nicholas Lutakome) has no login yet — need his real email to create one.");
