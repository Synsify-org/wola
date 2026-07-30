// apps/web/src/app/loans/[id]/page.tsx — the loan detail + repayment schedule.
// This is the page every "Schedule →" link in the loan register points at, and
// the terminus of the employee narrative: "here's my loan, my next deduction,
// my full schedule." Role-aware via the same RLS + user_id predicate as the
// register: an approver can open any loan in the tenant; an employee can only
// open a loan whose application belongs to them. A mismatched id 404s rather
// than leaking another person's loan.
//
// NOTE ON annual_rate: stored as a PERCENT (e.g. 9.5), per DECISIONS #5.
// Every component now treats it as a percent — ScheduleTable's ×100 bug was
// fixed at the source, so we pass the raw percent straight through.
//
// NOTE ON outstanding: scheduled balance only (assumes on-schedule payroll
// deduction). True outstanding needs the repayments table — deferred for the
// demo, same caveat as the register. Marked TODO for @wola/db (Willy).
import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { requireSession, scopePredicate } from "@/lib/guard";
import { resolveTenant } from "@wola/db";
import { db } from "@/lib/tenant";
import Shell from "@/components/shell";
import Metric from "@/components/metric";
import ScheduleTable from "@/components/schedule-table";
import DisburseButton from "@/components/disburse-button";
import {
  ArrowLeft,
  Banknote,
  CalendarClock,
  Wallet,
  TrendingDown,
} from "lucide-react";

// Finance roles that may disburse. Must match DISBURSER_ROLES in the action.
const DISBURSER_ROLES = ["cfo", "ceo", "md", "coo", "admin"];

const ugx = (n: number | string) =>
  "UGX " + Math.round(Number(n)).toLocaleString();
const shortDate = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

type LoanHead = {
  id: string;
  principal: string;
  annual_rate: string;
  tenor_months: number;
  status: string;
  start_date: string;
  employee_name: string;
  employee_no: string;
  product_name: string;
  purpose: string | null;
};

type LineRow = {
  period_no: number;
  due_date: string;
  instalment: string;
  principal_due: string;
  interest_due: string;
  closing_balance: string;
};

const statusChip: Record<string, string> = {
  active: "chip chip--approved",
  pending_disbursement: "chip chip--awaiting",
  settled: "chip",
  restructured: "chip",
  written_off: "chip chip--rejected",
};

const statusLabel = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default async function LoanDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const slug = (await headers()).get("x-tenant-slug") ?? "";
  const tenant = slug ? await resolveTenant(db, slug) : null;

  const data = await requireSession(async (tx, ctx) => {
    const [me] = await tx`
      SELECT e.full_name, u.email
      FROM users u LEFT JOIN employees e ON e.user_id = u.id
      WHERE u.id = ${ctx.userId}`;

    const user = {
      name: (me?.full_name as string) ?? (me?.email as string) ?? "User",
      email: (me?.email as string) ?? "",
      role: ctx.role,
      canSeeAllLoans: ctx.canSeeAllLoans,
      canApprove: ctx.canApprove,
    };

    // The loan header. RLS scopes to the tenant; scopePredicate enforces the
    // per-role data boundary: full-book roles see any loan, a dept head sees a
    // report's loan, an employee sees only their own. A loan outside scope
    // returns nothing and the page 404s — no cross-employee/department leak.
    const [loan] = (await tx`
      SELECT l.id, l.principal, l.annual_rate, l.tenor_months, l.status,
             l.start_date, la.purpose,
             e.full_name AS employee_name, e.employee_no,
             lp.name AS product_name
      FROM loans l
      JOIN loan_applications la ON la.id = l.application_id
      JOIN employees e ON e.id = la.employee_id
      JOIN loan_products lp ON lp.id = la.loan_product_id
      WHERE l.id = ${id}
        AND ${scopePredicate(tx, ctx)}
      LIMIT 1`) as unknown as LoanHead[];

    if (!loan) return { user, loan: null, lines: [] as LineRow[] };

    // Active schedule lines, ordered. schedule_lines.closing_balance is the
    // scheduled running balance; is_active picks the current schedule version
    // (a restructure would produce a new version and deactivate this one).
    const lines = (await tx`
      SELECT sl.period_no, sl.due_date, sl.instalment,
             sl.principal_due, sl.interest_due, sl.closing_balance
      FROM schedule_lines sl
      JOIN loan_schedules s ON s.id = sl.schedule_id
      WHERE s.loan_id = ${loan.id} AND s.is_active = true
      ORDER BY sl.period_no ASC`) as unknown as LineRow[];

    return { user, loan, lines, scope: ctx.scope, canDisburse: DISBURSER_ROLES.includes(ctx.role) };
  });

  const { user, loan, lines, scope, canDisburse } = data;
  if (!loan) notFound();

  // ScheduleTable wants { period, dueDate, instalment, principal, interest,
  // balance } — note it names the balance field `balance`, while the column is
  // `closing_balance`. Map here so the component contract is honoured.
  const schedule = lines.map((l) => ({
    period: l.period_no,
    dueDate: l.due_date,
    instalment: Number(l.instalment),
    principal: Number(l.principal_due),
    interest: Number(l.interest_due),
    balance: Number(l.closing_balance),
  }));

  const ratePct = Number(loan.annual_rate); // stored as percent, e.g. 9.5
  const monthly = schedule.length ? schedule[0].instalment : 0;

  // Next deduction = first unpaid scheduled line (first line due today or
  // later). Scheduled-only: we have no repayments table yet, so "unpaid" ==
  // "due date not in the past". Good enough for the demo; revisit with
  // repayments for true arrears handling.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const nextLine =
    schedule.find((l) => new Date(l.dueDate) >= today) ??
    schedule[schedule.length - 1] ??
    null;

  // Outstanding = closing balance of the most recent line already due
  // (scheduled). Falls back to principal before the first due date.
  const dueLines = schedule.filter((l) => new Date(l.dueDate) <= today);
  const outstanding = dueLines.length
    ? dueLines[dueLines.length - 1].balance
    : Number(loan.principal);

  const paidCount = dueLines.length;
  const totalCount = schedule.length;
  const progress = totalCount ? Math.round((paidCount / totalCount) * 100) : 0;

  return (
    <Shell user={user} tenantName={(tenant?.name as string) ?? "Wola"}>
      {/* Back link — to My loans for own scope, to the Book/Department view
          for oversight scopes (matches where the viewer came from). */}
      <Link
        href={scope === "own" ? "/loans" : "/book"}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-brand-700"
      >
        <ArrowLeft className="h-4 w-4" />
        {scope === "all" ? "Loan book" : scope === "department" ? "Department loans" : "My loans"}
      </Link>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-ink">
              {loan.product_name}
            </h1>
            <span className={statusChip[loan.status] ?? "chip"}>
              {statusLabel(loan.status)}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            {scope !== "own" ? (
              <>
                {loan.employee_name}{" "}
                <span className="num text-ink-faint">
                  · {loan.employee_no}
                </span>
              </>
            ) : (
              <>Started {shortDate(loan.start_date)}</>
            )}
            {loan.purpose ? <> · {loan.purpose}</> : null}
          </p>
        </div>
        {loan.status === "pending_disbursement" && canDisburse ? (
          <DisburseButton loanId={loan.id} amount={Number(loan.principal)} />
        ) : (
          <Link href="/apply" className="btn btn--ghost rounded-full text-sm">
            Apply for another
          </Link>
        )}
      </div>

      {/* Pending-disbursement notice for viewers who can't disburse */}
      {loan.status === "pending_disbursement" && !canDisburse ? (
        <div className="mb-6 rounded-xl border border-warning-600 bg-warning-100 p-4 text-sm text-warning-700">
          This loan is approved but not yet disbursed. Finance will release the
          funds; your repayment schedule below becomes active on disbursement.
        </div>
      ) : null}

      {/* Key figures — the numbers an employee opens this page to see */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric
          label="Next deduction"
          value={nextLine ? ugx(nextLine.instalment) : "—"}
          sub={nextLine ? shortDate(nextLine.dueDate) : undefined}
          icon={CalendarClock}
          accent="brand"
        />
        <Metric
          label="Outstanding"
          value={ugx(outstanding)}
          sub="Scheduled"
          icon={Wallet}
          accent="brand"
        />
        <Metric
          label="Monthly payment"
          value={ugx(monthly)}
          sub={`${ratePct.toFixed(1)}% p.a.`}
          icon={Banknote}
          accent="brand"
        />
        <Metric
          label="Principal"
          value={ugx(loan.principal)}
          sub={`${loan.tenor_months} months`}
          icon={TrendingDown}
          accent="brand"
        />
      </div>

      {/* Repayment progress */}
      {totalCount > 0 ? (
        <div className="mb-6 rounded-xl border border-rule bg-surface p-5 shadow-theme-sm">
          <div className="flex items-center justify-between">
            <div className="caps">Repayment progress</div>
            <div className="num text-xs text-ink-soft">
              {paidCount} of {totalCount} instalments · {progress}%
            </div>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-brand transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : null}

      {/* Full schedule. annual_rate is a percent (e.g. 9.5) and ScheduleTable
          now expects a percent, so pass it straight through. */}
      {schedule.length > 0 ? (
        <ScheduleTable schedule={schedule} annualRate={ratePct} />
      ) : (
        <div className="rounded-xl border border-rule bg-surface p-12 text-center shadow-theme-sm">
          <p className="text-sm text-ink-soft">
            No repayment schedule has been generated for this loan yet.
          </p>
          {loan.status === "pending_disbursement" ? (
            <p className="mt-1 text-xs text-ink-faint">
              The schedule appears once the loan is disbursed.
            </p>
          ) : null}
        </div>
      )}
    </Shell>
  );
}
