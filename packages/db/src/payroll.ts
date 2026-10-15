// packages/db/src/payroll.ts
// The payroll loop: what SHOULD come out of salaries this cycle, what actually did,
// and the actions that close the gap.
//
//   cycleReport      expected vs received, per loan, for a payroll month ("YYYY-MM")
//   expectedCsv      the file finance hands to payroll
//   previewActuals   match payroll's own file against expected, change nothing
//   postActuals      record what payroll's file says was deducted (one run)
//   postBulkRun      record every due deduction in one action (one run)
//
// "Expected" is never a guess: it is what the LEDGER says is needed for each loan to
// be up to date by the end of the cycle, measured from where the ledger stood at the
// START of the cycle (see ledger.ts amountDueThrough). That includes arrears brought
// forward, excludes payment holidays, and is exactly what recordRepayment will accept.
import { cycleBounds, dayBefore, windowsOverlap, type SuspensionWindow } from "@wola/engine";
import type { Tx } from "./client";
import { recordRepayment, repaymentPosition } from "./loans";
import { EPS, amountDueThrough, round2, withEffectiveDates, type RawLine } from "./ledger";

const TOL = 0.5; // whole-unit currencies: half a shilling is rounding, not a shortfall
const isoToday = () => new Date().toISOString().slice(0, 10);
const minIso = (a: string, b: string) => (a < b ? a : b);

export type CycleStatus = "paid" | "over" | "short" | "missed" | "awaiting" | "suspended";

export interface CycleLine {
  loanId: string;
  /** Short reference printed on the export and accepted back on import. */
  loanRef: string;
  employeeId: string;
  employeeNo: string;
  name: string;
  department: string | null;
  product: string;
  /** Needed this cycle for the loan to be up to date by its end. */
  expected: number;
  /** Of `expected`, the part that was already overdue when the cycle began. */
  arrearsBroughtForward: number;
  /** Of `expected`, the instalment(s) falling due inside the cycle. */
  scheduledInCycle: number;
  /** Money recorded against the loan with a value date in the cycle (any source). */
  received: number;
  receivedPayroll: number;
  /** What is still missing: max(0, expected - received). */
  remaining: number;
  status: CycleStatus;
  suspended: boolean;
}

export interface CycleTotals {
  loans: number;
  expected: number;
  received: number;
  /** Sum of `remaining` over loans still short. */
  shortfall: number;
  counts: Record<CycleStatus, number>;
}

export interface CycleReport {
  cycle: string;
  label: string;
  start: string;
  end: string;
  /** The cycle's last day hasn't passed yet, so "not received" is not yet "missed". */
  open: boolean;
  lines: CycleLine[];
  totals: CycleTotals;
}

export const loanRefOf = (loanId: string) => `LN-${loanId.slice(0, 8).toUpperCase()}`;

export async function cycleReport(
  tx: Tx, tenantId: string, cycle: string, today: string = isoToday(),
): Promise<CycleReport> {
  const { start, end, label } = cycleBounds(cycle);
  const open = end >= today;

  const loans = await tx`
    SELECT l.id, l.principal, e.id AS employee_id, e.employee_no, e.full_name, e.department, lp.name AS product
    FROM loans l
    JOIN loan_applications la ON la.id = l.application_id
    JOIN employees e ON e.id = la.employee_id
    JOIN loan_products lp ON lp.id = la.loan_product_id
    WHERE l.tenant_id = ${tenantId} AND l.status IN ('active', 'settled')
      AND l.start_date <= ${end}::date
    ORDER BY e.full_name, l.created_at`;
  const ids = loans.map((l) => l.id as string);

  const lineRows = ids.length ? await tx`
    SELECT s.loan_id, sl.period_no, to_char(sl.due_date, 'YYYY-MM-DD') AS due_iso,
           sl.opening_balance, sl.principal_due, sl.interest_due, sl.instalment, sl.closing_balance
    FROM schedule_lines sl
    JOIN loan_schedules s ON s.id = sl.schedule_id
    WHERE s.tenant_id = ${tenantId} AND s.is_active AND s.loan_id = ANY(${ids}::uuid[])
    ORDER BY s.loan_id, sl.period_no` : [];

  const repRows = ids.length ? await tx`
    SELECT loan_id,
      COALESCE(sum((allocation->>'principal')::numeric) FILTER (WHERE value_date < ${start}::date), 0) AS principal_before,
      COALESCE(sum((allocation->>'interest')::numeric)  FILTER (WHERE value_date < ${start}::date), 0) AS interest_before,
      COALESCE(sum(amount) FILTER (WHERE value_date BETWEEN ${start}::date AND ${end}::date), 0) AS received,
      COALESCE(sum(amount) FILTER (WHERE value_date BETWEEN ${start}::date AND ${end}::date AND source = 'payroll'), 0) AS received_payroll
    FROM repayments
    WHERE tenant_id = ${tenantId} AND loan_id = ANY(${ids}::uuid[])
    GROUP BY loan_id` : [];

  const holidayRows = ids.length ? await tx`
    SELECT loan_id, to_char(from_date, 'YYYY-MM-DD') AS from_iso, to_char(to_date, 'YYYY-MM-DD') AS to_iso
    FROM loan_suspensions
    WHERE tenant_id = ${tenantId} AND cancelled_at IS NULL AND loan_id = ANY(${ids}::uuid[])` : [];

  const linesBy = new Map<string, RawLine[]>();
  for (const r of lineRows) {
    const k = r.loan_id as string;
    if (!linesBy.has(k)) linesBy.set(k, []);
    linesBy.get(k)!.push(r as unknown as RawLine);
  }
  const repBy = new Map(repRows.map((r) => [r.loan_id as string, r]));
  const holidaysBy = new Map<string, SuspensionWindow[]>();
  for (const h of holidayRows) {
    const k = h.loan_id as string;
    if (!holidaysBy.has(k)) holidaysBy.set(k, []);
    holidaysBy.get(k)!.push({ from: h.from_iso as string, to: h.to_iso as string });
  }

  const out: CycleLine[] = [];
  for (const l of loans) {
    const id = l.id as string;
    const windows = holidaysBy.get(id) ?? [];
    const lines = withEffectiveDates(linesBy.get(id) ?? [], windows);
    const rep = repBy.get(id);
    const outstandingAtStart = Math.max(0, Number(l.principal) - Number(rep?.principal_before ?? 0));
    const interestBefore = Number(rep?.interest_before ?? 0);

    const arrears = amountDueThrough(lines, outstandingAtStart, interestBefore, dayBefore(start));
    const expected = amountDueThrough(lines, outstandingAtStart, interestBefore, end);
    const received = round2(Number(rep?.received ?? 0));
    const suspended = windows.some((w) => windowsOverlap(w, { from: start, to: end }));

    if (expected <= EPS && received <= EPS && !suspended) continue; // nothing to do for this loan

    let status: CycleStatus;
    if (suspended && expected <= TOL) status = "suspended";
    else if (received > expected + TOL) status = "over";
    else if (received >= expected - TOL) status = "paid";
    else if (open) status = "awaiting";
    else status = received > TOL ? "short" : "missed";

    out.push({
      loanId: id,
      loanRef: loanRefOf(id),
      employeeId: l.employee_id as string,
      employeeNo: l.employee_no as string,
      name: l.full_name as string,
      department: (l.department as string | null) ?? null,
      product: l.product as string,
      expected,
      arrearsBroughtForward: arrears,
      scheduledInCycle: round2(Math.max(0, expected - arrears)),
      received,
      receivedPayroll: round2(Number(rep?.received_payroll ?? 0)),
      remaining: round2(Math.max(0, expected - received)),
      status,
      suspended,
    });
  }

  const counts: Record<CycleStatus, number> = { paid: 0, over: 0, short: 0, missed: 0, awaiting: 0, suspended: 0 };
  let expectedTotal = 0, receivedTotal = 0, shortfall = 0;
  for (const l of out) {
    counts[l.status]++;
    expectedTotal += l.expected;
    receivedTotal += l.received;
    if (l.status === "short" || l.status === "missed" || l.status === "awaiting") shortfall += l.remaining;
  }
  return {
    cycle, label, start, end, open, lines: out,
    totals: { loans: out.length, expected: round2(expectedTotal), received: round2(receivedTotal), shortfall: round2(shortfall), counts },
  };
}

/** Arrears for every running loan as of `today`: what the ledger says is needed for
 *  the loan to be up to date, with payment holidays honoured. The same rule the
 *  payroll cycle uses for "arrears brought forward", so a report and the Payroll
 *  screen can't give two answers for one loan. */
export async function arrearsByLoan(tx: Tx, tenantId: string, today: string = isoToday()): Promise<Map<string, number>> {
  const loans = await tx`SELECT id, principal FROM loans WHERE tenant_id = ${tenantId} AND status = 'active'`;
  const ids = loans.map((l) => l.id as string);
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const lineRows = await tx`
    SELECT s.loan_id, sl.period_no, to_char(sl.due_date, 'YYYY-MM-DD') AS due_iso,
           sl.opening_balance, sl.principal_due, sl.interest_due, sl.instalment, sl.closing_balance
    FROM schedule_lines sl JOIN loan_schedules s ON s.id = sl.schedule_id
    WHERE s.tenant_id = ${tenantId} AND s.is_active AND s.loan_id = ANY(${ids}::uuid[])
    ORDER BY s.loan_id, sl.period_no`;
  const repRows = await tx`
    SELECT loan_id, COALESCE(sum((allocation->>'principal')::numeric), 0) AS p, COALESCE(sum((allocation->>'interest')::numeric), 0) AS i
    FROM repayments WHERE tenant_id = ${tenantId} AND loan_id = ANY(${ids}::uuid[]) GROUP BY loan_id`;
  const holidayRows = await tx`
    SELECT loan_id, to_char(from_date, 'YYYY-MM-DD') AS f, to_char(to_date, 'YYYY-MM-DD') AS t
    FROM loan_suspensions WHERE tenant_id = ${tenantId} AND cancelled_at IS NULL AND loan_id = ANY(${ids}::uuid[])`;
  const linesBy = new Map<string, RawLine[]>();
  for (const r of lineRows) { const k = r.loan_id as string; (linesBy.get(k) ?? linesBy.set(k, []).get(k)!).push(r as unknown as RawLine); }
  const repBy = new Map(repRows.map((r) => [r.loan_id as string, r]));
  const winBy = new Map<string, SuspensionWindow[]>();
  for (const h of holidayRows) { const k = h.loan_id as string; (winBy.get(k) ?? winBy.set(k, []).get(k)!).push({ from: h.f as string, to: h.t as string }); }
  for (const l of loans) {
    const id = l.id as string;
    const rep = repBy.get(id);
    const outstanding = Math.max(0, Number(l.principal) - Number(rep?.p ?? 0));
    out.set(id, amountDueThrough(withEffectiveDates(linesBy.get(id) ?? [], winBy.get(id) ?? []), outstanding, Number(rep?.i ?? 0), today));
  }
  return out;
}

// ----------------------------------------------------------------- CSV (out)

/** RFC 4180 escaping: quote a field that contains a comma, quote or newline. */
export const csvField = (v: string | number | null | undefined): string => {
  const s = v === null || v === undefined ? "" : String(v);
  // Spreadsheet formula injection: a cell starting with = + - @ would be run as a
  // formula by Excel. Names come from HR data, so neutralise them.
  const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const EXPECTED_CSV_HEADER = [
  "cycle", "employee_no", "employee_name", "department", "product", "loan_ref",
  "expected_deduction", "arrears_included", "scheduled_this_cycle",
] as const;

/** The deductions payroll should take this cycle (suspended loans and loans with
 *  nothing to take are left out). */
export function expectedCsv(report: CycleReport): string {
  const rows = report.lines.filter((l) => l.expected > EPS && l.status !== "suspended");
  const body = rows.map((l) =>
    [report.cycle, l.employeeNo, l.name, l.department ?? "", l.product, l.loanRef, l.expected, l.arrearsBroughtForward, l.scheduledInCycle]
      .map(csvField).join(","));
  return [EXPECTED_CSV_HEADER.join(","), ...body].join("\r\n") + "\r\n";
}

// ----------------------------------------------------------------- CSV (in)

/** A small RFC 4180 parser (quoted fields, doubled quotes, CRLF or LF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export interface ActualRow {
  line: number;
  employeeNo: string;
  loanRef: string | null;
  amount: number;
  valueDate: string | null;
}

export function parseActualsCsv(text: string): { rows: ActualRow[]; errors: { line: number; message: string }[] } {
  const grid = parseCsv(text);
  if (grid.length === 0) return { rows: [], errors: [{ line: 1, message: "The file is empty." }] };
  const header = grid[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iNo = col("employee_no", "employee_number", "staff_no", "payroll_no");
  const iAmt = col("amount", "deducted", "deduction", "actual", "amount_deducted");
  const iRef = col("loan_ref", "loan_reference", "loan");
  const iDate = col("value_date", "date", "paid_on");
  if (iNo < 0 || iAmt < 0) {
    return { rows: [], errors: [{ line: 1, message: "The first row must have columns named employee_no and amount (loan_ref and value_date are optional)." }] };
  }
  const rows: ActualRow[] = [];
  const errors: { line: number; message: string }[] = [];
  grid.slice(1).forEach((cells, idx) => {
    const line = idx + 2;
    const employeeNo = (cells[iNo] ?? "").trim();
    const raw = (cells[iAmt] ?? "").replace(/[,\s]/g, "");
    const amount = Number(raw);
    const date = iDate >= 0 ? (cells[iDate] ?? "").trim() : "";
    if (!employeeNo) { errors.push({ line, message: "Missing employee_no." }); return; }
    if (raw === "" || !Number.isFinite(amount) || amount <= 0) { errors.push({ line, message: `"${cells[iAmt] ?? ""}" isn't an amount above zero.` }); return; }
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { errors.push({ line, message: `Date "${date}" must be YYYY-MM-DD.` }); return; }
    rows.push({ line, employeeNo, loanRef: iRef >= 0 ? ((cells[iRef] ?? "").trim().toUpperCase() || null) : null, amount: round2(amount), valueDate: date || null });
  });
  return { rows, errors };
}

// ---------------------------------------------------------------- preview

export type MatchStatus = "exact" | "short" | "over" | "too_much" | "already_paid" | "unmatched" | "ambiguous" | "duplicate";

export interface PreviewRow {
  row: ActualRow;
  status: MatchStatus;
  loan: CycleLine | null;
  message: string;
  /** Postable: exact / short / over. */
  postable: boolean;
}

export interface ActualsPreview {
  report: CycleReport;
  rows: PreviewRow[];
  parseErrors: { line: number; message: string }[];
  /** Loans that owed something this cycle but are not in the file at all. */
  missing: CycleLine[];
  totals: { fileTotal: number; postable: number; postableTotal: number; blocked: number; missing: number; missingTotal: number };
}

export async function previewActuals(
  tx: Tx, tenantId: string, cycle: string, csv: string, today: string = isoToday(),
): Promise<ActualsPreview> {
  const parsed = parseActualsCsv(csv);
  const report = await cycleReport(tx, tenantId, cycle, today);
  const byEmployee = new Map<string, CycleLine[]>();
  for (const l of report.lines) {
    if (l.status === "suspended") continue;
    const k = l.employeeNo.toLowerCase();
    if (!byEmployee.has(k)) byEmployee.set(k, []);
    byEmployee.get(k)!.push(l);
  }

  const seen = new Set<string>();
  const covered = new Set<string>();
  const rows: PreviewRow[] = [];
  for (const row of parsed.rows) {
    const candidates = byEmployee.get(row.employeeNo.toLowerCase()) ?? [];
    let loan: CycleLine | null = null;
    let message = "";
    let status: MatchStatus | null = null;

    if (candidates.length === 0) { status = "unmatched"; message = "No loan with an instalment due this cycle for that employee number."; }
    else if (row.loanRef) {
      const hits = candidates.filter((c) => c.loanRef === row.loanRef);
      if (hits.length === 1) loan = hits[0];
      else { status = "unmatched"; message = `That employee has no loan ${row.loanRef} due this cycle.`; }
    } else if (candidates.length === 1) loan = candidates[0];
    else { status = "ambiguous"; message = `${candidates.length} loans are due for this employee; add a loan_ref column to say which (${candidates.map((c) => c.loanRef).join(", ")}).`; }

    if (loan && seen.has(loan.loanId)) { status = "duplicate"; message = "This loan appears twice in the file; only the first row is used."; loan = null; }

    if (loan && !status) {
      seen.add(loan.loanId);
      covered.add(loan.loanId);
      const diff = round2(row.amount - loan.remaining);
      if (loan.remaining <= TOL) {
        // Fully received already (e.g. this same file was posted before): posting
        // again would be recorded as an overpayment, so it is refused.
        status = "already_paid";
        message = "Already fully recorded for this cycle, so it isn't recorded again.";
      } else if (Math.abs(diff) <= TOL) { status = "exact"; message = "Matches what was expected."; }
      else if (diff < 0) { status = "short"; message = `Short by ${Math.abs(diff)} against ${loan.remaining} still expected.`; }
      else {
        const pos = await repaymentPosition(tx, tenantId, loan.loanId);
        if (row.amount > pos.payoff + EPS) { status = "too_much"; message = `More than the whole payoff (${pos.payoff}); it can't be recorded.`; }
        else { status = "over"; message = `${diff} more than the ${loan.remaining} expected.`; }
      }
    }
    const postable = status === "exact" || status === "short" || status === "over";
    rows.push({ row, status: status!, loan, message, postable });
  }

  const missing = report.lines.filter((l) => l.status !== "suspended" && l.remaining > TOL && !covered.has(l.loanId));
  const postableRows = rows.filter((r) => r.postable);
  return {
    report, rows, parseErrors: parsed.errors, missing,
    totals: {
      fileTotal: round2(parsed.rows.reduce((s, r) => s + r.amount, 0)),
      postable: postableRows.length,
      postableTotal: round2(postableRows.reduce((s, r) => s + r.row.amount, 0)),
      blocked: rows.length - postableRows.length,
      missing: missing.length,
      missingTotal: round2(missing.reduce((s, l) => s + l.remaining, 0)),
    },
  };
}

// ------------------------------------------------------------------ posting

export interface RunResult {
  runId: string | null;
  cycle: string;
  kind: "bulk" | "import";
  posted: number;
  postedTotal: number;
  expectedTotal: number;
  skipped: { employeeNo?: string; name?: string; reason: string }[];
}

async function lockCycle(tx: Tx, tenantId: string, cycle: string) {
  // One posting at a time per organisation and cycle: a double click, or two
  // finance people at once, can't both record the same deductions.
  await tx`SELECT pg_advisory_xact_lock(hashtext(${"payroll:" + tenantId + ":" + cycle}))`;
}

async function writeRun(
  tx: Tx,
  args: { tenantId: string; cycle: string; kind: "bulk" | "import"; actorId: string | null; note: string | null;
          plan: { loanId: string; amount: number; valueDate: string }[]; expectedTotal: number },
): Promise<{ runId: string; postedTotal: number }> {
  const planned = round2(args.plan.reduce((s, p) => s + p.amount, 0));
  const [run] = await tx`
    INSERT INTO payroll_runs (tenant_id, cycle, kind, loan_count, expected_total, posted_total, note, created_by)
    VALUES (${args.tenantId}, ${args.cycle}, ${args.kind}, ${args.plan.length}, ${args.expectedTotal}, ${planned}, ${args.note}, ${args.actorId})
    RETURNING id`;
  const runId = run.id as string;
  for (const p of args.plan) {
    await recordRepayment(tx, {
      tenantId: args.tenantId, loanId: p.loanId, amount: p.amount, source: "payroll",
      valueDate: new Date(p.valueDate), postedBy: args.actorId, payrollRunId: runId,
    });
  }
  // Tie-out: what the run says it posted is exactly what the ledger now holds.
  const [tie] = await tx`SELECT COALESCE(sum(amount), 0) AS total, count(*)::int AS n FROM repayments WHERE tenant_id = ${args.tenantId} AND payroll_run_id = ${runId}`;
  if (Math.abs(Number(tie.total) - planned) > EPS || Number(tie.n) !== args.plan.length) {
    throw new Error(`Payroll run did not tie out: planned ${planned} over ${args.plan.length} loans, ledger holds ${tie.total} over ${tie.n}.`);
  }
  return { runId, postedTotal: planned };
}

/** Record every due deduction for the cycle in one action. Loans already paid,
 *  suspended, or with nothing due are left alone, so running it twice records
 *  nothing the second time. All or nothing: one transaction. */
export async function postBulkRun(
  tx: Tx, args: { tenantId: string; cycle: string; actorId: string | null; today?: string },
): Promise<RunResult> {
  const today = args.today ?? isoToday();
  await lockCycle(tx, args.tenantId, args.cycle);
  const report = await cycleReport(tx, args.tenantId, args.cycle, today);
  const valueDate = minIso(report.end, today);
  const owing = report.lines.filter((l) => l.status !== "suspended" && l.remaining > TOL);
  // A past cycle still lists loans settled since (its history), and one paid off early
  // can show a gap there; a settled loan takes no more money, so it is skipped.
  const activeRows = owing.length ? await tx`
    SELECT id FROM loans WHERE tenant_id = ${args.tenantId} AND status = 'active'
      AND id = ANY(${owing.map((l) => l.loanId)}::uuid[])` : [];
  const active = new Set(activeRows.map((r) => r.id as string));
  const due = owing.filter((l) => active.has(l.loanId));
  const skipped = owing.filter((l) => !active.has(l.loanId))
    .map((l) => ({ employeeNo: l.employeeNo, name: l.name, reason: "Loan already settled; nothing more to deduct." }));
  if (due.length === 0) {
    return { runId: null, cycle: args.cycle, kind: "bulk", posted: 0, postedTotal: 0, expectedTotal: 0, skipped };
  }
  const plan = due.map((l) => ({ loanId: l.loanId, amount: l.remaining, valueDate }));
  const expectedTotal = round2(due.reduce((s, l) => s + l.expected, 0));
  const { runId, postedTotal } = await writeRun(tx, {
    tenantId: args.tenantId, cycle: args.cycle, kind: "bulk", actorId: args.actorId,
    note: "Recorded the expected deduction for every loan that was due.", plan, expectedTotal,
  });
  return { runId, cycle: args.cycle, kind: "bulk", posted: plan.length, postedTotal, expectedTotal, skipped };
}

/** Record what payroll's own file says was deducted. Re-checks the file against the
 *  ledger inside the transaction (the preview a person looked at is not trusted), and
 *  records only rows that match a loan and fit within its payoff. */
export async function postActuals(
  tx: Tx, args: { tenantId: string; cycle: string; csv: string; actorId: string | null; fileName?: string | null; today?: string },
): Promise<RunResult> {
  const today = args.today ?? isoToday();
  await lockCycle(tx, args.tenantId, args.cycle);
  const pv = await previewActuals(tx, args.tenantId, args.cycle, args.csv, today);
  const defaultDate = minIso(pv.report.end, today);

  const postable = pv.rows.filter((r) => r.postable && r.loan);
  const skipped = [
    ...pv.parseErrors.map((e) => ({ reason: `Line ${e.line}: ${e.message}` })),
    ...pv.rows.filter((r) => !r.postable).map((r) => ({ employeeNo: r.row.employeeNo, reason: `Line ${r.row.line}: ${r.message}` })),
  ];
  if (postable.length === 0) {
    return { runId: null, cycle: args.cycle, kind: "import", posted: 0, postedTotal: 0, expectedTotal: 0, skipped };
  }
  const plan = postable.map((r) => {
    const d = r.row.valueDate;
    // A date from the file is honoured only inside the cycle (and not in the future).
    const valueDate = d && d >= pv.report.start && d <= minIso(pv.report.end, today) ? d : defaultDate;
    return { loanId: r.loan!.loanId, amount: r.row.amount, valueDate };
  });
  const expectedTotal = round2(postable.reduce((s, r) => s + r.loan!.remaining, 0));
  const { runId, postedTotal } = await writeRun(tx, {
    tenantId: args.tenantId, cycle: args.cycle, kind: "import", actorId: args.actorId,
    note: args.fileName ? `Imported from ${args.fileName}` : "Imported from payroll file", plan, expectedTotal,
  });
  return { runId, cycle: args.cycle, kind: "import", posted: plan.length, postedTotal, expectedTotal, skipped };
}
