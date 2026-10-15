// apps/web/src/app/loans/[id]/page.tsx — the loan detail + repayment schedule.
// This is the page every "Schedule →" link in the loan register points at, and
// the terminus of the employee narrative: "here's my loan, my next deduction,
// my full schedule." Role-aware via the same RLS + user_id predicate as the
// register: an approver can open any loan in the tenant; an employee can only
// open a loan whose application belongs to them. A mismatched id 404s rather
// than leaking another person's loan.
//
// NOTE ON annual_rate: stored as a FRACTION (e.g. 0.16 = 16%) — see
// resolveRate() in approvals.ts and the write in applications/[id]/actions.ts.
// This page converts to a percent (×100) once here for display; ScheduleTable
// expects a percent, not a fraction of a fraction.
//
// NOTE ON outstanding and next deduction: both come from the repayment LEDGER
// via repaymentPosition() (@wola/db), the same source the repayment allocator
// uses, never from schedule dates alone, which kept showing a "next
// deduction" on loans already repaid early or in full.
import { DISBURSER_ROLES } from "@/lib/permissions";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession, scopePredicate } from "@/lib/guard";
import { repaymentPosition, listEarlyRepaymentRequests, listSuspensions, type RepaymentPosition, type Suspension } from "@wola/db";
import Metric from "@/components/metric";
import ScheduleTable from "@/components/schedule-table";
import DisburseButton from "@/components/disburse-button";
import RepayButton from "@/components/repay-button";
import EarlyRepaymentPanel from "@/components/early-repayment-panel";
import { EMPLOYEE_DATA_ROLES } from "@/lib/permissions";
import {
  CheckCircle2,
  Banknote,
  CalendarClock,
  Wallet,
  TrendingDown,
} from "lucide-react";
import { formatMoney } from "@wola/engine";
import { getTenantCurrency } from "@/lib/tenant";
import { pageMeta } from "@/lib/site";
import Breadcrumbs from "@/components/breadcrumbs";
import { humanize } from "@/lib/product-summary";
import { displayPurpose } from "@/lib/purpose";

// Finance roles that may disburse. Must match DISBURSER_ROLES in the action.

type PaymentRow = { id: string; value_date: string; amount: string; source: string; principal: string; interest: string };
const SOURCE_LABEL: Record<string, string> = { payroll: "Payroll deduction", manual: "Payment recorded by finance", early: "Early repayment" };

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
  borrower_user: string | null;
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

const statusLabel = humanize;

export const metadata = pageMeta({ title: "Loan", description: "A loan: its repayment schedule, balance and payment history.", path: "/loans" });

export default async function LoanDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const currency = await getTenantCurrency();
  const ugx = (n: number | string) => formatMoney(Number(n), currency);

  const data = await requireSession(async (tx, ctx) => {
    // The loan header. RLS scopes to the tenant; scopePredicate enforces the
    // per-role data boundary: full-book roles see any loan, a dept head sees a
    // report's loan, an employee sees only their own. A loan outside scope
    // returns nothing and the page 404s — no cross-employee/department leak.
    const [loan] = (await tx`
      SELECT l.id, l.principal, l.annual_rate, l.tenor_months, l.status,
             l.start_date, la.purpose,
             e.full_name AS employee_name, e.employee_no, e.user_id AS borrower_user,
             lp.name AS product_name
      FROM loans l
      JOIN loan_applications la ON la.id = l.application_id
      JOIN employees e ON e.id = la.employee_id
      JOIN loan_products lp ON lp.id = la.loan_product_id
      WHERE l.id = ${id}
        AND ${scopePredicate(tx, ctx)}
      LIMIT 1`) as unknown as LoanHead[];

    if (!loan) return {
      loan: null, lines: [] as LineRow[],
      scope: ctx.scope, canDisburse: false, canRepay: false,
      position: null as RepaymentPosition | null,
      openRequest: null as { id: string; kind: "full" | "partial"; amount: number | null; mine: boolean } | null,
      canRequestEarly: false, holidays: [] as Suspension[], payments: [] as PaymentRow[],
    };

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

    // Every deduction and payment actually received, newest first (the ledger itself).
    const payments = (await tx`
      SELECT id, to_char(value_date, 'YYYY-MM-DD') AS value_date, amount, source,
             COALESCE((allocation->>'principal')::numeric, 0) AS principal,
             COALESCE((allocation->>'interest')::numeric, 0) AS interest
      FROM repayments
      WHERE loan_id = ${loan.id}
      ORDER BY value_date DESC, created_at DESC`) as unknown as PaymentRow[];

    // Outstanding, progress and the next deduction, all from the ledger.
    const position = await repaymentPosition(tx, ctx.tenantId, loan.id as string);

    // Early repayment: the borrower asks for their own loan; HR may ask for someone
    // who is leaving. Payment holidays are shown to everyone who can see the loan.
    const [open] = await listEarlyRepaymentRequests(tx, ctx.tenantId, { loanId: loan.id as string, status: "requested" });
    const holidays = (await listSuspensions(tx, ctx.tenantId, loan.id as string)).filter((h) => !h.cancelled);
    const isBorrower = loan.borrower_user === ctx.userId;

    return {
      loan, lines, scope: ctx.scope,
      canDisburse: DISBURSER_ROLES.includes(ctx.role),
      canRepay: DISBURSER_ROLES.includes(ctx.role),
      position,
      openRequest: open ? { id: open.id, kind: open.kind, amount: open.amount, mine: open.requestedBy === ctx.userId } : null,
      canRequestEarly: isBorrower || EMPLOYEE_DATA_ROLES.includes(ctx.role),
      holidays,
      payments,
    };
  });

  const { loan, lines, scope, canDisburse, canRepay, position, openRequest, canRequestEarly, holidays, payments } = data;
  if (!loan || !position) notFound();

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

  const ratePct = Number(loan.annual_rate) * 100; // fraction -> percent, e.g. 0.16 -> 16.0
  const purpose = displayPurpose(loan.purpose);
  const monthly = schedule.length ? schedule[0].instalment : 0;

  // Everything below is ledger-derived (repaymentPosition), so a loan repaid
  // early or in full never shows a pending deduction, and a part-paid
  // instalment shows only its remainder.
  const { next, outstanding, principalRepaid } = position;
  const settled = loan.status === "settled" || (loan.status === "active" && outstanding <= 0);
  const progress = settled
    ? 100
    : Number(loan.principal) > 0
      ? Math.round((principalRepaid / Number(loan.principal)) * 100)
      : 0;

  const nextDeduction: { value: string; sub?: string; accent: "brand" | "approved" | "awaiting"; icon: typeof CalendarClock } =
    settled
      ? { value: "Nothing due", sub: "Fully repaid", accent: "approved", icon: CheckCircle2 }
      : next
        ? {
            value: ugx(next.amount),
            sub: (next.overdue ? "Overdue since " : "Due ") + shortDate(next.dueDate),
            accent: next.overdue ? "awaiting" : "brand",
            icon: CalendarClock,
          }
        : {
            value: "—",
            sub: loan.status === "pending_disbursement" ? "Starts after disbursement" : statusLabel(loan.status),
            accent: "brand",
            icon: CalendarClock,
          };

  // Pre-fill the repayment form with what's actually due (never more than the
  // payoff — the server refuses overpayments, and the final instalment is
  // often smaller than the level one).
  const suggestedRepayment = next?.amount ?? position.payoff;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: scope === "all" ? "Loan book" : scope === "department" ? "Department loans" : "My loans", href: scope === "own" ? "/loans" : "/book" },
          { label: loan.product_name as string },
        ]}
      />

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
            {purpose ? <> · {purpose}</> : null}
          </p>
        </div>
        {loan.status === "pending_disbursement" && canDisburse ? (
          <DisburseButton loanId={loan.id} amount={Number(loan.principal)} currency={currency} />
        ) : loan.status === "active" && canRepay ? (
          <RepayButton key={position.payoff} loanId={loan.id} suggested={suggestedRepayment} currency={currency} />
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

      {/* Payment holidays recorded on this loan (instalments move later; nothing is forgiven) */}
      {holidays.length > 0 ? (
        <div className="mb-6 rounded-xl border border-rule bg-surface p-4 text-sm text-ink-soft shadow-theme-sm">
          {holidays.map((h) => (
            <p key={h.id}>
              <span className="chip chip--awaiting">Payments paused</span>{" "}
              {shortDate(h.from)} to {shortDate(h.to)}: {h.reason}. Later instalments move back by the same time.
            </p>
          ))}
        </div>
      ) : null}

      {loan.status === "active" && !settled && canRequestEarly ? (
        <EarlyRepaymentPanel
          loanId={loan.id}
          payoff={position.payoff}
          currency={currency}
          open={openRequest}
        />
      ) : null}

      {/* Key figures — the numbers an employee opens this page to see */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Next deduction"
          value={nextDeduction.value}
          sub={nextDeduction.sub}
          icon={nextDeduction.icon}
          accent={nextDeduction.accent}
        />
        <Metric
          tone="brand"
          label="Outstanding"
          value={ugx(outstanding)}
          sub={settled ? "Fully repaid" : "Ledger balance"}
          icon={Wallet}
          accent={settled ? "approved" : "brand"}
        />
        <Metric
          tone="info"
          label="Monthly payment"
          value={ugx(monthly)}
          // The rate was fixed when the loan was approved: a later CBR change never moves it.
          sub={ratePct === 0 ? "Interest-free" : `${ratePct.toFixed(1)}% p.a., fixed at approval`}
          icon={Banknote}
          accent="brand"
        />
        <Metric
          tone="deep"
          label="Principal"
          value={ugx(loan.principal)}
          sub={`${loan.tenor_months} months`}
          icon={TrendingDown}
          accent="brand"
        />
      </div>

      {/* Repayment progress — driven by the ledger (principal repaid). */}
      {schedule.length > 0 ? (
        <div className="mb-6 rounded-xl border border-rule bg-surface p-5 shadow-theme-sm">
          <div className="flex items-center justify-between">
            <div className="caps">Repayment progress</div>
            <div className="num text-xs text-ink-soft">
              {settled
                ? <>Fully repaid · {ugx(Number(loan.principal))} principal · 100%</>
                : <>{ugx(principalRepaid)} of {ugx(Number(loan.principal))} principal · {progress}%</>}
            </div>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={"h-full rounded-full transition-[width] duration-500 ease-out " + (settled ? "bg-approved" : "bg-brand")}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : null}

      {/* Deductions received: what payroll (or the borrower) actually paid, from the ledger. */}
      {payments.length > 0 ? (
        <div className="mb-6 rounded-xl border border-rule bg-surface p-5 shadow-theme-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="caps">Deductions received</div>
            <div className="num text-xs text-ink-soft">
              {payments.length} payment{payments.length === 1 ? "" : "s"} · {ugx(payments.reduce((t, p) => t + Number(p.amount), 0))} in total
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Source</th>
                  <th className="r">Amount</th>
                  <th className="r">Principal</th>
                  <th className="r">Interest</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="text-sm text-ink">{shortDate(p.value_date)}</td>
                    <td className="text-sm text-ink-soft">{SOURCE_LABEL[p.source] ?? p.source}</td>
                    <td className="num r text-sm font-medium text-ink">{ugx(p.amount)}</td>
                    <td className="num r text-sm text-ink-soft">{ugx(p.principal)}</td>
                    <td className="num r text-sm text-ink-soft">{ugx(p.interest)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Full schedule. annual_rate is a fraction; ratePct above already
          converted it to a percent for ScheduleTable. */}
      {schedule.length > 0 ? (
        <ScheduleTable schedule={schedule} annualRate={ratePct} currency={currency} />
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
    </>
  );
}