import Link from "next/link";
import { Wallet } from "lucide-react";
import CountUp from "./count-up";
import DashboardCard from "./dashboard-card";
import { formatMoney } from "@wola/engine";

const shortDate = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const roleLabel = (r: string) =>
  r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export type LoanPosition = {
  loanId: string;
  product: string;
  principal: number;
  outstanding: number;
  monthlyDeduction: number;
  nextDueDate: string | null;
  progressPct: number;
};
export type ApplicationInFlight = {
  applicationId: string;
  product: string;
  amount: number;
  stageRole: string | null;
};
export type EligibilityPreviewItem = {
  productId: string;
  productName: string;
  maxAmount: number;
};
export type Mine = {
  loans: LoanPosition[];
  applicationsInFlight: ApplicationInFlight[];
  eligibility: EligibilityPreviewItem[];
} | null;

// The Employee hero: "where do I stand, and what comes out of my next
// payslip." A personal-finance card, not a data grid — the outstanding
// balance is the biggest thing on the screen. Everything else (applications,
// eligibility) is a quieter, secondary panel below it.
export default function DashboardEmployee({ mine, currency }: { mine: Mine; currency: string }) {
  const ugx = (n: number) => formatMoney(n, currency);
  const empty = !mine || (mine.loans.length === 0 && mine.applicationsInFlight.length === 0);

  if (empty) {
    return (
      <div className="grid gap-4 lg:grid-cols-3 xl:gap-5">
        <div className="flex flex-col items-center rounded-2xl border border-rule bg-surface px-6 py-10 text-center shadow-theme-xs animate-in fade-in slide-in-from-bottom-2 duration-500 lg:col-span-2">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-700">
            <Wallet className="h-7 w-7" strokeWidth={1.75} aria-hidden />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-ink">Nothing on your record yet</h2>
          <p className="mt-1 max-w-sm text-sm text-ink-soft">
            You have no loans or applications yet. Check what you qualify for and apply in a few minutes.
          </p>
          <Link href="/apply" className="btn btn--primary mt-6 inline-flex rounded-full">
            Apply for a loan
          </Link>
        </div>
        <DashboardCard title="How it works">
          <ol className="space-y-4">
            {[
              ["Check your limit", "Your salary sets how much each product lets you borrow."],
              ["Apply", "Pick a product, an amount and a repayment period."],
              ["Approval", "Your application moves through each approver; track it here."],
              ["Payroll repays it", "Deductions come out of your payslip automatically."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                  {i + 1}
                </span>
                <div>
                  <div className="text-sm font-medium text-ink">{t}</div>
                  <div className="text-[0.8125rem] text-ink-soft">{d}</div>
                </div>
              </li>
            ))}
          </ol>
        </DashboardCard>
      </div>
    );
  }

  const hasLoans = mine.loans.length > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-3 xl:gap-5">
      {/* HERO (2/3): one position card per active loan. The outstanding
          balance is the biggest number on the screen. */}
      {hasLoans ? (
        <div className={"grid content-start gap-4 lg:col-span-2 xl:gap-5 " + (mine.loans.length > 1 ? "md:grid-cols-2" : "")}>
          {mine.loans.map((loan, i) => (
            <article
              key={loan.loanId}
              className="@container flex flex-col rounded-2xl border border-rule bg-surface p-5 shadow-theme-xs animate-in fade-in slide-in-from-bottom-2 duration-500 sm:p-6"
              style={{ animationDelay: i * 75 + "ms" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-base font-medium text-ink">{loan.product}</div>
                  <div className="text-[0.8125rem] text-ink-soft">Outstanding balance</div>
                </div>
                <Wallet className="h-5 w-5 shrink-0 text-brand" strokeWidth={2} aria-hidden />
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="num whitespace-nowrap text-[1.75rem] font-semibold leading-none tracking-tight text-ink @[22rem]:text-[2.125rem]">
                  <CountUp value={loan.outstanding} format="money" currency={currency} />
                </span>
                <span className="chip chip--approved">{loan.progressPct}% repaid</span>
              </div>
              <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-brand transition-all duration-500 ease-out"
                  style={{ width: `${Math.min(100, Math.max(0, loan.progressPct))}%` }}
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                {loan.nextDueDate ? (
                  <p className="text-sm text-ink-soft">
                    Next deduction <span className="num font-medium text-ink">{ugx(loan.monthlyDeduction)}</span> on{" "}
                    {shortDate(loan.nextDueDate)}
                  </p>
                ) : (
                  <p className="text-sm text-ink-soft">No further deduction scheduled.</p>
                )}
                <Link href={`/loans/${loan.loanId}`} className="text-sm font-medium text-brand hover:underline">
                  View schedule &rarr;
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {/* 1/3 column: applications in flight + what you can borrow. */}
      <div
        className={
          "grid content-start gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150 xl:gap-5 " +
          (hasLoans ? "" : "sm:grid-cols-2 lg:col-span-3")
        }
      >
        <DashboardCard title="Applications in flight">
          {mine.applicationsInFlight.length === 0 ? (
            <p className="text-sm text-ink-soft">Nothing in review right now.</p>
          ) : (
            <ul className="space-y-3">
              {mine.applicationsInFlight.map((a) => (
                <li key={a.applicationId} className="flex items-center justify-between gap-2">
                  <Link
                    href={`/applications/${a.applicationId}`}
                    className="min-w-0 flex-1 truncate text-sm font-medium text-ink hover:text-brand"
                  >
                    {a.product}
                  </Link>
                  <span className="chip chip--awaiting shrink-0">
                    {a.stageRole ? roleLabel(a.stageRole) + " stage" : "In review"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>

        <DashboardCard title="What you can borrow">
          {mine.eligibility.length === 0 ? (
            <p className="text-sm text-ink-soft">No products currently available to you.</p>
          ) : (
            <ul className="space-y-3">
              {mine.eligibility.map((e) => (
                <li key={e.productId} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">{e.productName}</span>
                  <span className="num shrink-0 text-sm font-semibold text-brand-700">
                    up to <CountUp value={e.maxAmount} format="money" currency={currency} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>
      </div>
    </div>
  );
}
