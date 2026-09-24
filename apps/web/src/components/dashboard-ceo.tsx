import DashboardCard from "./dashboard-card";
import DecisionQueue from "./decision-queue";
import TrendLineChart from "./trend-line-chart";
import type { CollectionsPoint } from "./dashboard-cfo";
import { Wallet, Layers } from "lucide-react";
import FeaturedMetric from "./featured-metric";
import BookBreakup from "./book-breakup";
import CountUp from "./count-up";

export type CEOInboxItem = {
  applicationId: string;
  employeeName: string;
  productName: string;
  amount: number;
  stageRole: string;
};
export type MixRow = { name: string; kind: string; n: number; principal: number };

// The CEO hero: "is the loan programme healthy" — oversight, not operations.
// Deliberately calmer and lighter than the CFO's console: a trend, not a
// worklist; no disbursement, no reconciliation, no employee register. If
// this ever starts looking as busy as dashboard-cfo.tsx, it's wrong.
export default function DashboardCEO({
  totalExposure,
  valueUnderManagement,
  exposureTrend,
  inProgress,
  settled,
  rejectedThisYear,
  inbox,
  mix,
  collections,
  currency,
}: {
  totalExposure: number;
  valueUnderManagement: number;
  exposureTrend: number[];
  inProgress: number;
  settled: number;
  rejectedThisYear: number;
  inbox: CEOInboxItem[];
  mix: MixRow[];
  collections: CollectionsPoint[];
  currency: string;
}) {
  const activity = [
    { label: "In progress", value: inProgress, tone: "bg-warning-500" },
    { label: "Settled", value: settled, tone: "bg-success-500" },
    { label: "Rejected this year", value: rejectedThisYear, tone: "bg-error-500" },
  ];

  return (
    <div className="space-y-4 xl:space-y-5">
      {/* HERO (row 1): programme health + trend, with the activity counts as
          the third column instead of a loose strip underneath. */}
      <section className="grid gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 md:grid-cols-2 xl:grid-cols-3 xl:gap-5">
        <FeaturedMetric
          label="Total exposure"
          value={<CountUp value={totalExposure} format="money" currency={currency} />}
          sub="Current outstanding across the book"
          icon={Wallet}
          trend={exposureTrend}
        />
        <FeaturedMetric
          label="Value under management"
          value={<CountUp value={valueUnderManagement} format="money" currency={currency} />}
          sub="Principal disbursed, active loans"
          icon={Layers}
          trend={exposureTrend}
        />
        <DashboardCard title="Programme activity" className="md:col-span-2 xl:col-span-1">
          <ul className="space-y-4">
            {activity.map((a) => (
              <li key={a.label} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2.5 text-sm text-ink-soft">
                  <span className={"h-2.5 w-2.5 rounded-full " + a.tone} aria-hidden />
                  {a.label}
                </span>
                <span className="num text-xl font-semibold text-ink"><CountUp value={a.value} /></span>
              </li>
            ))}
          </ul>
        </DashboardCard>
      </section>

      {/* Row 2 (2/3 + 1/3): collections trend beside the product mix. */}
      <section className="grid gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150 lg:grid-cols-3 xl:gap-5">
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
          className={mix.length > 0 ? "lg:col-span-2" : "lg:col-span-3"}
        />
        {mix.length > 0 ? <BookBreakup data={mix} total={valueUnderManagement} currency={currency} /> : null}
      </section>

      {/* Row 3: the CEO-stage queue — quiet, not the hero. */}
      <DecisionQueue
        title="Awaiting your sign-off"
        items={inbox}
        currency={currency}
        emptyText="Nothing awaiting your sign-off."
        className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200"
      />
    </div>
  );
}
