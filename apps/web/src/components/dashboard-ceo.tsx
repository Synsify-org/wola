import Link from "next/link";
import { Wallet, Layers } from "lucide-react";
import FeaturedMetric from "./featured-metric";
import BookBreakup from "./book-breakup";
import CountUp from "./count-up";
import { formatMoney } from "@wola/engine";

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
  currency: string;
}) {
  const ugx = (n: number) => formatMoney(n, currency);
  return (
    <div className="space-y-6">
      {/* HERO: programme health + trend */}
      <section className="grid gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 lg:grid-cols-2">
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
      </section>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-rule bg-surface px-5 py-3 text-sm shadow-theme-sm animate-in fade-in slide-in-from-bottom-2 duration-500 delay-75">
        <span className="text-ink-soft">
          In progress <span className="num font-semibold text-ink"><CountUp value={inProgress} /></span>
        </span>
        <span className="text-ink-soft">
          Settled <span className="num font-semibold text-ink"><CountUp value={settled} /></span>
        </span>
        <span className="text-ink-soft">
          Rejected this year <span className="num font-semibold text-ink"><CountUp value={rejectedThisYear} /></span>
        </span>
      </div>

      {/* Secondary: CEO-stage queue + product mix — both quiet, neither the hero. */}
      <section className="grid gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Awaiting your sign-off</h2>
            {inbox.length > 0 ? (
              <Link href="/approvals" className="text-xs font-medium text-brand hover:underline">
                View all
              </Link>
            ) : null}
          </div>
          {inbox.length === 0 ? (
            <div className="rounded-xl border border-rule bg-surface p-6 text-center shadow-theme-sm">
              <p className="text-sm text-ink-soft">Nothing awaiting your sign-off.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-rule bg-surface shadow-theme-sm">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Applicant</th>
                    <th>Product</th>
                    <th className="r">Amount</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {inbox.map((item) => (
                    <tr key={item.applicationId}>
                      <td className="font-medium text-ink">{item.employeeName}</td>
                      <td className="text-ink-soft">{item.productName}</td>
                      <td className="r num">{ugx(item.amount)}</td>
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
        </div>

        {mix.length > 0 ? <BookBreakup data={mix} total={valueUnderManagement} currency={currency} /> : null}
      </section>
    </div>
  );
}
