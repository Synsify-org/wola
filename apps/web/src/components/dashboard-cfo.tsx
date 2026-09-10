import Link from "next/link";
import Metric from "./metric";
import { Clock, Wallet, Banknote, TrendingUp } from "lucide-react";
import BookBreakup from "./book-breakup";
import PipelinePanel from "./pipeline-panel";
import RecentActivity from "./recent-activity";
import CFOMoneyOps, { type DisbursementQueueItem, type ReconciliationCycle } from "./cfo-money-ops";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();

type Book = {
  awaitingMe: number;
  totalExposure: number;
  activeLoans: number;
  principalDisbursed: number;
  interestBook: number;
  interestBookPriorMonth: number;
};
export type InboxItem = {
  applicationId: string;
  employeeName: string;
  productName: string;
  amount: number;
  tenorMonths: number;
  stageRole: string;
};
export type MixRow = { name: string; kind: string; n: number; principal: number };
type PipelineRow = { status: string; n: number };
type RecentRow = {
  id: string;
  borrower: string;
  product: string;
  principal: number;
  date: string | null;
};

const roleLabel = (r: string) =>
  r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function DashboardCFO({
  book,
  inbox,
  mix,
  pipeline,
  recent,
  exposureTrend,
  canDisburse,
  queue,
  reconciliation,
}: {
  book: Book;
  inbox: InboxItem[];
  mix: MixRow[];
  pipeline: PipelineRow[];
  recent: RecentRow[];
  exposureTrend: number[];
  canDisburse: boolean;
  queue: DisbursementQueueItem[];
  reconciliation: ReconciliationCycle | null;
}) {
  // Real month-over-month delta on cumulative principal disbursed — omitted
  // (not fabricated) when there isn't a prior month to compare against, or
  // the prior month was zero (an undefined % change). This is what
  // exposureTrend actually measures (disbursement growth), so it's the exact
  // metric for "Principal disbursed" below. Reused on "Total exposure" too,
  // as a PROXY — exposure also falls as repayments post, which this series
  // doesn't capture; a true outstanding-over-time trend needs a merged
  // disbursed/repaid timeline, not built yet.
  const n = exposureTrend.length;
  const prev = n >= 2 ? exposureTrend[n - 2] : null;
  const last = n >= 1 ? exposureTrend[n - 1] : null;
  const disbursementDelta =
    prev !== null && last !== null && prev > 0
      ? {
          dir: (last >= prev ? "up" : "down") as "up" | "down",
          pct: Math.round(Math.abs((last - prev) / prev) * 100),
          note: "vs last month",
        }
      : undefined;

  // Real delta for interestBook — see the interestBookPriorMonth caveat on
  // ApproverMetrics (packages/db/src/metrics.ts): an approximation using only
  // loans that already existed ~1 month ago, not a true historical snapshot.
  const interestDelta =
    book.interestBookPriorMonth > 0
      ? {
          dir: (book.interestBook >= book.interestBookPriorMonth ? "up" : "down") as "up" | "down",
          pct: Math.round(
            Math.abs((book.interestBook - book.interestBookPriorMonth) / book.interestBookPriorMonth) * 100,
          ),
          note: "vs last month",
        }
      : undefined;

  return (
    <div className="space-y-6">
      {/* Book at a glance — sits right under the welcome banner on every
          dashboard now (user request), ahead of the role-specific hero. */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Total exposure"
          value={ugx(book.totalExposure)}
          sub={book.activeLoans + " active loan" + (book.activeLoans === 1 ? "" : "s")}
          icon={Wallet}
          accent="brand"
          trend={disbursementDelta}
        />
        {/* No delta chip: a queue depth is a point-in-time count, not a
            cumulative flow — there's no ledger history of "awaiting" size
            to compare against honestly. The sub-text already says the
            thing that matters (clear vs needs a decision). */}
        <Metric
          label="Awaiting you"
          value={String(book.awaitingMe)}
          sub={book.awaitingMe > 0 ? "Needs your decision" : "Nothing pending"}
          accent={book.awaitingMe > 0 ? "awaiting" : "approved"}
          icon={Clock}
        />
        <Metric
          label="Principal disbursed"
          value={ugx(book.principalDisbursed)}
          sub="Total lent out"
          accent="brand"
          icon={Banknote}
          trend={disbursementDelta}
        />
        <Metric
          label="Interest book"
          value={ugx(book.interestBook)}
          sub="If every loan runs to term"
          accent="brand"
          icon={TrendingUp}
          trend={interestDelta}
        />
      </section>

      {/* HERO: money-operations console — disbursement + reconciliation.
          Only for roles that can actually disburse (see DISBURSER_ROLES in
          page.tsx). This is the one component no other role's dashboard has. */}
      {canDisburse ? <CFOMoneyOps queue={queue} reconciliation={reconciliation} /> : null}

      {/* Needs your decision */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Needs your decision</h2>
          {inbox.length > 0 ? (
            <Link href="/approvals" className="text-xs font-medium text-brand hover:underline">
              View all
            </Link>
          ) : null}
        </div>
        {inbox.length === 0 ? (
          <div className="rounded-xl border border-rule bg-surface p-6 text-center shadow-theme-sm">
            <p className="text-sm text-ink-soft">Nothing is waiting on you. The queue is clear.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-rule bg-surface shadow-theme-sm">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th>Product</th>
                  <th className="r">Amount</th>
                  <th className="r">Tenor</th>
                  <th>Stage</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {inbox.map((item) => (
                  <tr key={item.applicationId}>
                    <td className="font-medium text-ink">{item.employeeName}</td>
                    <td className="text-ink-soft">{item.productName}</td>
                    <td className="r num">{ugx(item.amount)}</td>
                    <td className="r num">{item.tenorMonths} mo</td>
                    <td>
                      <span className="chip chip--awaiting">{roleLabel(item.stageRole)}</span>
                    </td>
                    <td className="r">
                      <Link
                        href={"/approvals?app=" + item.applicationId}
                        className="text-xs font-medium text-brand hover:underline"
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Book: product bars + application pipeline, side by side */}
      <section className="grid gap-4 lg:grid-cols-2">
        {mix.length > 0 ? (
          <BookBreakup data={mix} total={book.principalDisbursed} delta={disbursementDelta} />
        ) : null}
        <PipelinePanel data={pipeline} />
      </section>

      {/* Recent activity */}
      <section>
        <RecentActivity data={recent} />
      </section>

      {/* Personal loans: demoted */}
      <section className="border-t border-rule pt-6">
        <Link href="/loans?mine=1" className="text-sm text-ink-soft hover:text-ink">
          View my own loans and applications &rarr;
        </Link>
      </section>
    </div>
  );
}
