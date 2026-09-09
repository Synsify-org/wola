import Link from "next/link";
import { Wallet } from "lucide-react";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();
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
export default function DashboardEmployee({ mine }: { mine: Mine }) {
  const empty = !mine || (mine.loans.length === 0 && mine.applicationsInFlight.length === 0);

  if (empty) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-ink">Dashboard</h1>
          <p className="mt-1 text-sm text-ink-soft">Where do I stand, and what comes out of my next payslip?</p>
        </div>
        <div className="rounded-xl border border-rule bg-surface p-8 text-center shadow-theme-sm">
          <p className="text-sm text-ink-soft">You have no loans or applications yet.</p>
          <Link href="/apply" className="btn btn--primary mt-5 inline-block rounded-full">
            Apply for a loan
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-soft">Where do I stand, and what comes out of my next payslip?</p>
      </div>

      {/* HERO: position card(s) — one per active loan, stacked. */}
      {mine.loans.length > 0 ? (
        <div className="space-y-3">
          {mine.loans.map((loan) => (
            <div
              key={loan.loanId}
              className="rounded-xl border border-rule bg-surface p-6 shadow-theme-md"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium text-ink-soft">
                  <Wallet className="h-3.5 w-3.5" />
                  {loan.product} · Outstanding
                </div>
                <span className="chip chip--awaiting">{loan.progressPct}% repaid</span>
              </div>
              <div className="num mt-1 text-3xl font-bold text-ink">{ugx(loan.outstanding)}</div>
              {loan.nextDueDate ? (
                <p className="mt-1 text-sm text-ink-soft">
                  Next deduction <span className="num font-medium text-ink">{ugx(loan.monthlyDeduction)}</span> on{" "}
                  {shortDate(loan.nextDueDate)}
                </p>
              ) : (
                <p className="mt-1 text-sm text-ink-soft">No further deduction scheduled.</p>
              )}
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-brand transition-all duration-500 ease-out"
                  style={{ width: `${Math.min(100, Math.max(0, loan.progressPct))}%` }}
                />
              </div>
              <Link
                href={`/loans/${loan.loanId}`}
                className="mt-4 inline-block text-xs font-medium text-brand hover:underline"
              >
                View schedule &rarr;
              </Link>
            </div>
          ))}
        </div>
      ) : null}

      {/* Secondary: applications in flight + eligibility preview, side by side. */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-rule bg-surface p-4 shadow-theme-sm">
          <div className="caps mb-3">Applications in flight</div>
          {mine.applicationsInFlight.length === 0 ? (
            <p className="text-sm text-ink-soft">Nothing in review right now.</p>
          ) : (
            <ul className="space-y-2.5">
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
        </div>

        <div className="rounded-xl border border-rule bg-surface p-4 shadow-theme-sm">
          <div className="caps mb-3">Eligibility</div>
          {mine.eligibility.length === 0 ? (
            <p className="text-sm text-ink-soft">No products currently available to you.</p>
          ) : (
            <ul className="space-y-2.5">
              {mine.eligibility.map((e) => (
                <li key={e.productId} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">{e.productName}</span>
                  <span className="num shrink-0 text-sm font-semibold text-brand-700">up to {ugx(e.maxAmount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="flex gap-3">
        <Link href="/loans" className="btn btn--ghost rounded-full">
          View my loans
        </Link>
        <Link href="/apply" className="btn btn--primary rounded-full">
          Apply for a loan
        </Link>
      </div>
    </div>
  );
}
