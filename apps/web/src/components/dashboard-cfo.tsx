import Link from "next/link";
import Metric from "./metric";
import { Clock, Wallet, Banknote, TrendingUp } from "lucide-react";
import ProductBars from "./product-bars";
import PipelinePanel from "./pipeline-panel";
import RecentActivity from "./recent-activity";
import FeaturedMetric from "./featured-metric";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();

type Book = {
  awaitingMe: number;
  totalExposure: number;
  activeLoans: number;
  principalDisbursed: number;
  interestBook: number;
};
type InboxItem = {
  applicationId: string;
  employeeName: string;
  productName: string;
  amount: number;
  tenorMonths: number;
  stageRole: string;
};
type MixRow = { name: string; kind: string; n: number; principal: number };
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
}: {
  book: Book;
  inbox: InboxItem[];
  mix: MixRow[];
  pipeline: PipelineRow[];
  recent: RecentRow[];
  exposureTrend: number[];
}) {
  return (
    <div className="space-y-6">
      {/* Featured exposure + metric grid */}
      <section className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <FeaturedMetric
            label="Total exposure"
            value={ugx(book.totalExposure)}
            sub={"Across " + book.activeLoans + " active loan" + (book.activeLoans === 1 ? "" : "s")}
            icon={Wallet}
            trend={exposureTrend}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-3">
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
          />
          <Metric
            label="Interest book"
            value={ugx(book.interestBook)}
            sub="If every loan runs to term"
            accent="brand"
            icon={TrendingUp}
          />
        </div>
      </section>

      {/* Hero: needs your decision */}
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
        {mix.length > 0 ? <ProductBars data={mix} /> : null}
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
