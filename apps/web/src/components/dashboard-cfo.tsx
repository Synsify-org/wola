import Link from "next/link";
import Metric from "./metric";
import CountUp from "./count-up";
import { Clock, Wallet, Banknote, TrendingUp } from "lucide-react";
import BookBreakup from "./book-breakup";
import PipelinePanel from "./pipeline-panel";
import RecentActivity from "./recent-activity";
import DecisionQueue from "./decision-queue";
import TrendLineChart from "./trend-line-chart";
import CFOMoneyOps, { type DisbursementQueueItem, type ReconciliationCycle } from "./cfo-money-ops";

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
export type CollectionsPoint = { label: string; month: string; expected: number; collected: number; current: boolean };
type RecentRow = {
  id: string;
  borrower: string;
  product: string;
  principal: number;
  date: string | null;
};


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
  currency,
  collections,
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
  currency: string;
  collections: CollectionsPoint[];
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
    <div className="space-y-4 xl:space-y-5">
      {/* Book at a glance — sits right under the welcome banner on every
          dashboard now (user request), ahead of the role-specific hero. */}
      <section className="grid grid-cols-1 gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
        <Metric
          label="Total exposure"
          value={<CountUp value={book.totalExposure} format="money" currency={currency} />}
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
          value={<CountUp value={book.awaitingMe} />}
          sub={book.awaitingMe > 0 ? "Needs your decision" : "Nothing pending"}
          accent={book.awaitingMe > 0 ? "awaiting" : "approved"}
          icon={Clock}
        />
        <Metric
          label="Principal disbursed"
          value={<CountUp value={book.principalDisbursed} format="money" currency={currency} />}
          sub="Total lent out"
          accent="brand"
          icon={Banknote}
          trend={disbursementDelta}
        />
        <Metric
          label="Interest book"
          value={<CountUp value={book.interestBook} format="money" currency={currency} />}
          sub="If every loan runs to term"
          accent="brand"
          icon={TrendingUp}
          trend={interestDelta}
        />
      </section>

      {/* Row 1 (2/3 + 1/3): collections trend beside the application pipeline. */}
      <section className="grid gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-75 lg:grid-cols-3 xl:gap-5">
        <TrendLineChart
          title="Collections"
          subtitle={`Money received against instalments due, last 6 months · ${currency}`}
          data={collections}
          actual={{ key: "collected", label: "Collected", color: "var(--color-brand)" }}
          target={{ key: "expected", label: "Expected", color: "var(--color-chart-target)" }}
          currency={currency}
          markerX={collections.find((c) => c.current)?.label}
          compareNote="vs expected"
          emptyText="No instalments fell due in the last six months, so there's nothing to compare yet."
          csvName="collections"
          reportHref="/reports"
          className="lg:col-span-2"
        />
        <PipelinePanel data={pipeline} />
      </section>

      {/* Row 2 (2/3 + 1/3): the money-operations console — the CFO's hero,
          only for roles that can actually disburse — beside the book breakup. */}
      {canDisburse || mix.length > 0 ? (
        <section className="grid gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150 lg:grid-cols-3 xl:gap-5">
          {canDisburse ? (
            <div className={"min-w-0 " + (mix.length > 0 ? "lg:col-span-2" : "lg:col-span-3")}>
              <CFOMoneyOps queue={queue} reconciliation={reconciliation} currency={currency} />
            </div>
          ) : null}
          {mix.length > 0 ? (
            <div className={"min-w-0 " + (canDisburse ? "" : "lg:col-span-3")}>
              <BookBreakup data={mix} total={book.principalDisbursed} delta={disbursementDelta} currency={currency} />
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Row 3 (2/3 + 1/3): decision worklist beside recent activity. */}
      <section className="grid gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200 lg:grid-cols-3 xl:gap-5">
        <DecisionQueue
          title="Needs your decision"
          items={inbox}
          currency={currency}
          showTenor
          showStage
          className="lg:col-span-2"
        />
        <RecentActivity data={recent} currency={currency} />
      </section>

      {/* Personal loans: demoted */}
      <Link href="/loans?mine=1" className="inline-block text-sm text-ink-soft transition-colors hover:text-ink">
        View my own loans and applications &rarr;
      </Link>
    </div>
  );
}
