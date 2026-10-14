// packages/db/src/practice-data.ts
// Practice loans and a payroll history for a TRIAL organisation, so a client can experience Wola the way they
// would after buying it: their real people, with a believable book behind them.
//
// Everything is made with the application's own code paths and the application's own database role (no admin
// connection, no raw ledger writes): applications are decided by the real approval engine, loans and their
// schedules come from createLoanFromApplication, money out from disburseLoan, money in from recordRepayment
// and the payroll bulk run. The one thing that is NOT real is who "approved" the history: practice accounts
// ("Practice CFO", ...) on addresses that can never receive mail and have no usable password.
//
// Guards, all enforced here and not only in the screen:
//   - only an organisation flagged as a trial (tenants.settings.trial = true) can receive practice data;
//   - the full book is refused unless the organisation has no loans or applications yet;
//   - nobody is ever emailed (practice addresses are reserved names; see sendEmail).
// The ledger and audit trail are append-only, so practice entries cannot be removed afterwards: a trial
// organisation is thrown away whole, it is never converted into a real one.
import { cycleBounds, shiftCycle } from "@wola/engine";
import { tenantTx, audit, type Sql, type Tx } from "./client";
import { decide, resolveRate, routeApplication } from "./approvals";
import { createLoanFromApplication, disburseLoan, recordRepayment } from "./loans";
import { cycleReport, postBulkRun } from "./payroll";
import { setRateIndex } from "./rate-indices";

export const PRACTICE_PURPOSE = "[practice] ";
const PRACTICE_RATE = 9.5; // a practice central-bank rate; the administrator changes it in Settings

export interface PracticeSummary {
  historyLoans: number;
  awaitingDisbursement: number;
  inFlight: number;
  rejected: number;
  payrollMonths: number;
  deductions: number;
}

type Actor = { userId: string; employeeId: string | null; role: string };
type Person = { id: string; no: string; name: string; department: string | null; gross: number; net: number; headId: string | null };

const ROLES = ["hr", "cfo", "ceo", "coo", "dept_head"] as const;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const monthsAgo = (today: Date, k: number, day: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - k, day));
const roundTo = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);

async function requireTrial(tx: Tx, tenantId: string): Promise<{ slug: string }> {
  const [t] = await tx`SELECT slug, settings FROM tenants WHERE id = ${tenantId}`;
  if (!t) throw new Error("Organisation not found.");
  if ((t.settings as { trial?: boolean } | null)?.trial !== true) {
    throw new Error("Practice data can only be loaded into an organisation flagged as a trial. This one is not.");
  }
  return { slug: t.slug as string };
}

/** The accounts that "decided" the practice history. Addresses end in .invalid (never deliverable) and the
 *  password hash is not a hash at all, so nobody can ever sign in as them. They are listed under Roles & access
 *  and can be removed there. */
async function practiceActors(tx: Tx, tenantId: string, slug: string): Promise<Record<(typeof ROLES)[number], Actor>> {
  const out = {} as Record<(typeof ROLES)[number], Actor>;
  for (const role of ROLES) {
    const email = `practice.${role}@${slug}.invalid`;
    const name = `Practice ${role === "dept_head" ? "department head" : role.toUpperCase()}`;
    const [u] = await tx`
      INSERT INTO users (email, name, status, password_hash) VALUES (${email}, ${name}, 'active', '!')
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
    await tx`
      INSERT INTO memberships (tenant_id, user_id, role) VALUES (${tenantId}, ${u.id}, ${role})
      ON CONFLICT (tenant_id, user_id, role) DO NOTHING`;
    out[role] = { userId: u.id as string, employeeId: null, role };
  }
  return out;
}

/** Borrowers: active, past probation, with pay on file; spread across departments (one per department per round). */
async function candidates(tx: Tx, tenantId: string): Promise<{ withHead: Person[]; anyone: Person[] }> {
  const rows = await tx`
    SELECT e.id, e.employee_no, e.full_name, e.department, e.gross_salary::float AS g, e.net_salary::float AS n, e.department_head_id,
           (SELECT 1 FROM employees h WHERE h.id = e.department_head_id AND h.status = 'active') AS head_ok
    FROM employees e
    WHERE e.tenant_id = ${tenantId} AND e.status = 'active' AND e.is_post_probation AND NOT e.on_final_warning
      AND e.gross_salary > 0 AND e.net_salary > 0 AND e.user_id IS NULL
    ORDER BY e.employee_no`;
  const people: Person[] = rows.map((r) => ({
    id: r.id as string, no: r.employee_no as string, name: r.full_name as string, department: r.department as string | null,
    gross: Number(r.g), net: Number(r.n), headId: r.head_ok ? (r.department_head_id as string) : null,
  }));
  const spread = (list: Person[]) => {
    const by = new Map<string, Person[]>();
    for (const p of list) by.set(p.department ?? "", [...(by.get(p.department ?? "") ?? []), p]);
    const out: Person[] = [];
    for (let i = 0; out.length < list.length; i++) for (const g of by.values()) if (g[i]) out.push(g[i]);
    return out;
  };
  return { withHead: spread(people.filter((p) => p.headId)), anyone: spread(people) };
}

/** Month by month, record that payroll deducted what the schedule said, up to the month before last; leave LAST
 *  month imperfect on purpose (one loan missed, one short) so there is something to resolve in a demo. */
export async function runPayrollHistory(tx: Tx, tenantId: string, today: Date): Promise<{ months: number; deductions: number }> {
  const thisMonth = ymd(today).slice(0, 7);
  const lastMonth = shiftCycle(thisMonth, -1);
  const [{ first }] = await tx`SELECT to_char(min(start_date), 'YYYY-MM') AS first FROM loans WHERE tenant_id = ${tenantId} AND status IN ('active', 'settled')`;
  if (!first) return { months: 0, deductions: 0 };
  let months = 0, deductions = 0;
  for (let c = first as string; c < lastMonth; c = shiftCycle(c, 1)) {
    const r = await postBulkRun(tx, { tenantId, cycle: c, actorId: null, today: cycleBounds(c).end });
    months++; deductions += r.posted;
  }
  if (first <= lastMonth) {
    const rep = await cycleReport(tx, tenantId, lastMonth, cycleBounds(lastMonth).end);
    for (const [i, l] of rep.lines.filter((x) => x.remaining > 0.5).entries()) {
      if (i === 0) continue; // missed: nothing deducted
      const amount = i === 1 ? Math.round(l.remaining / 2) : l.remaining; // short, then in full
      await recordRepayment(tx, { tenantId, loanId: l.loanId, amount, source: "payroll", valueDate: new Date(cycleBounds(lastMonth).end) });
      deductions++;
    }
    months++;
  }
  return { months, deductions };
}

/** Payroll history only, for an organisation that already has loans (for example the sales demo company). */
export async function loadPayrollHistory(sql: Sql, tenantId: string, opts: { actorId?: string | null; today?: Date } = {}) {
  return tenantTx(sql, tenantId, async (tx) => {
    await requireTrial(tx, tenantId);
    const [{ n }] = await tx`SELECT count(*)::int AS n FROM payroll_runs WHERE tenant_id = ${tenantId}`;
    if (Number(n) > 0) throw new Error("This organisation already has payroll history. Recording more would double-count deductions.");
    const r = await runPayrollHistory(tx, tenantId, opts.today ?? new Date());
    await audit(tx, { tenantId, actorId: opts.actorId ?? null, action: "practice_data.payroll_history", entity: "tenant", after: r });
    return r;
  });
}

/** The full practice book: history loans with a payroll history, one loan waiting for disbursement, applications
 *  at every approval stage, and a rejection. */
export async function loadPracticeBook(sql: Sql, tenantId: string, opts: { actorId?: string | null; today?: Date } = {}): Promise<PracticeSummary> {
  const today = opts.today ?? new Date();
  return tenantTx(sql, tenantId, async (tx) => {
    const { slug } = await requireTrial(tx, tenantId);
    const [{ n }] = await tx`SELECT (SELECT count(*) FROM loans WHERE tenant_id = ${tenantId}) + (SELECT count(*) FROM loan_applications WHERE tenant_id = ${tenantId}) AS n`;
    if (Number(n) > 0) throw new Error("This organisation already has loans or applications. Practice data is only loaded into an empty trial.");

    const prods = await tx`SELECT id, kind FROM loan_products WHERE tenant_id = ${tenantId} AND active = true`;
    const product = (kind: string) => prods.find((p) => p.kind === kind)?.id as string | undefined;
    if (!product("advance") || !product("term") || !product("asset")) throw new Error("The trial needs its three loan products (advance, development, car) first.");

    const { withHead, anyone } = await candidates(tx, tenantId);
    if (anyone.length < 6) throw new Error(`Only ${anyone.length} people are eligible to borrow (active, past probation, with pay and no login). Import the staff and fill in pay and probation first; at least 6 are needed.`);

    await setRateIndex(tx, { tenantId, name: "CBR", value: PRACTICE_RATE, effectiveFrom: monthsAgo(today, 7, 1) });
    const actors = await practiceActors(tx, tenantId, slug);

    // Scenarios in priority order, so a small organisation still gets the most telling ones.
    type Scenario = { kind: "advance" | "term" | "asset"; ago?: number; tenor: number; flow: "history" | "pending" | "dept" | "hr" | "cfo" | "ceo" | "rejected"; needsHead: boolean };
    const plan: Scenario[] = [
      { flow: "history", kind: "term", tenor: 24, ago: 5, needsHead: false },
      { flow: "history", kind: "term", tenor: 36, ago: 4, needsHead: false },
      { flow: "history", kind: "asset", tenor: 36, ago: 6, needsHead: false },
      { flow: "history", kind: "advance", tenor: 2, ago: 3, needsHead: false }, // two instalments, started three months ago: fully repaid
      { flow: "pending", kind: "advance", tenor: 2, needsHead: true },
      { flow: "dept", kind: "advance", tenor: 2, needsHead: true },
      { flow: "hr", kind: "term", tenor: 18, needsHead: true },
      { flow: "cfo", kind: "term", tenor: 24, needsHead: true },
      { flow: "ceo", kind: "asset", tenor: 36, needsHead: true },
      { flow: "rejected", kind: "advance", tenor: 3, needsHead: true },
      { flow: "history", kind: "advance", tenor: 3, ago: 1, needsHead: false },
      { flow: "history", kind: "term", tenor: 18, ago: 3, needsHead: false },
      { flow: "history", kind: "term", tenor: 12, ago: 2, needsHead: false },
      { flow: "dept", kind: "term", tenor: 12, needsHead: true },
    ];

    const used = new Set<string>();
    const take = (needsHead: boolean): Person | undefined => {
      const p = (needsHead ? withHead : anyone).find((x) => !used.has(x.id));
      if (p) used.add(p.id);
      return p;
    };
    const amountFor = (kind: string, p: Person) =>
      kind === "advance" ? roundTo(p.gross * 0.6, 50_000) : kind === "term" ? roundTo(p.gross * 1.8, 100_000) : roundTo(p.net * 8, 500_000);

    const summary: PracticeSummary = { historyLoans: 0, awaitingDisbursement: 0, inFlight: 0, rejected: 0, payrollMonths: 0, deductions: 0 };
    const approveAs = async (applicationId: string, role: (typeof ROLES)[number], head?: Person, startDate?: Date) => {
      const actor = role === "dept_head" ? { ...actors.dept_head, employeeId: head!.headId } : actors[role];
      const r = await decide(tx, { tenantId, applicationId, actor, decision: "approved", startDate });
      if (!r.ok) throw new Error(`Practice approval by ${role} failed: ${r.error}`);
    };

    for (const s of plan) {
      const p = take(s.needsHead);
      if (!p) continue;
      const productId = product(s.kind)!;
      const purpose = `${PRACTICE_PURPOSE}${s.kind === "advance" ? "Salary advance" : s.kind === "term" ? "Development loan" : "Staff car loan"}`;
      const amount = amountFor(s.kind, p);

      if (s.flow === "history") {
        // Late in the month (25th-28th): this month's instalments are not due until then, so only last month's
        // deliberate missed and short deductions show as "behind", not every loan merely waiting for this month's payroll.
        const start = monthsAgo(today, s.ago!, 25 + (summary.historyLoans % 4));
        const [appn] = await tx`
          INSERT INTO loan_applications (tenant_id, employee_id, loan_product_id, amount, tenor_months, status, purpose, created_at)
          VALUES (${tenantId}, ${p.id}, ${productId}, ${amount}, ${s.tenor}, 'approved', ${purpose}, ${addDays(start, -7)}) RETURNING id`;
        const loaded = await routeApplication(tx, appn.id as string);
        // The decisions that led to it, dated before the loan began.
        for (const [i, stage] of (loaded?.routing.stages ?? []).entries()) {
          const role = stage.approverRole as (typeof ROLES)[number];
          const actor = actors[role] ?? actors.hr;
          await tx`
            INSERT INTO approvals (tenant_id, application_id, stage_id, approver_user_id, decision, comment, decided_at)
            VALUES (${tenantId}, ${appn.id}, ${stage.id}, ${actor.userId}, 'approved', NULL, ${addDays(start, -6 + i)})`;
        }
        const rate = await resolveRate(tx, productId);
        if (!rate.ok) throw new Error(rate.error);
        const { loanId } = await createLoanFromApplication(tx, { tenantId, applicationId: appn.id as string, startDate: start, annualRate: rate.rate, rateMode: rate.mode });
        await disburseLoan(tx, { tenantId, loanId, disbursedAt: start, postedBy: actors.cfo.userId });
        summary.historyLoans++;
        continue;
      }

      const [appn] = await tx`
        INSERT INTO loan_applications (tenant_id, employee_id, loan_product_id, amount, tenor_months, status, purpose)
        VALUES (${tenantId}, ${p.id}, ${productId}, ${amount}, ${s.tenor}, 'submitted', ${purpose}) RETURNING id`;
      const id = appn.id as string;
      if (s.flow === "dept") { summary.inFlight++; continue; }
      if (s.flow === "rejected") {
        const r = await decide(tx, { tenantId, applicationId: id, actor: { ...actors.dept_head, employeeId: p.headId }, decision: "rejected", comment: "Already repaying another loan this quarter. Please apply again next cycle." });
        if (!r.ok) throw new Error(`Practice rejection failed: ${r.error}`);
        summary.rejected++;
        continue;
      }
      await approveAs(id, "dept_head", p);
      if (s.flow === "hr") { summary.inFlight++; continue; }
      await approveAs(id, "hr");
      if (s.flow === "cfo") { summary.inFlight++; continue; }
      await approveAs(id, "cfo");
      if (s.flow === "ceo") { summary.inFlight++; continue; }
      // pending: fully approved, waiting for finance to disburse (a live step in the demo)
      await approveAs(id, "ceo", undefined, today);
      summary.awaitingDisbursement++;
    }

    const hist = await runPayrollHistory(tx, tenantId, today);
    summary.payrollMonths = hist.months; summary.deductions = hist.deductions;

    await tx`UPDATE tenants SET settings = settings || ${tx.json({ practiceDataLoadedAt: new Date().toISOString() } as never)}::jsonb WHERE id = ${tenantId}`;
    await audit(tx, { tenantId, actorId: opts.actorId ?? null, action: "practice_data.loaded", entity: "tenant", after: summary });
    return summary;
  });
}
