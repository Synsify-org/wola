"use client";
import {
  PieChart, Pie, Cell,
} from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import TrendLineChart from "./trend-line-chart";
import Metric from "./metric";
import ProductBars from "./product-bars";
import DashboardCard from "./dashboard-card";
import CountUp from "./count-up";
import { FileText, CheckCircle, Wallet, Layers, Clock3 } from "lucide-react";
import { formatMoney } from "@wola/engine";

type Book = { totalExposure: number; activeLoans: number; principalDisbursed: number; interestBook: number };
type StatusCount = { status: string; n: number };
type TrendPoint = { label: string; total: number; approved: number };
export type DeptRow = { name: string; kind?: string; n: number; principal: number };
type SizeBand = { band: string; n: number };
type PerfRow = { product: string; apps: number; avgAmount: number; approvalRate: number };
type RejectionRow = { stageRole: string; n: number };

const STATUS_COLOR: Record<string, string> = {
  approved: "#027a48",
  submitted: "#b54708",
  in_review: "#2e90fa",
  rejected: "#b42318",
};
const label = (r: string) => r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function AnalyticsView({
  book, mix, statusCounts, totalApps, approvalRate, trend, byDepartment, sizeBands, productPerf,
  avgDecisionDays, rejectionsByStage, currency, collections,
}: {
  book: Book;
  mix: DeptRow[];
  statusCounts: StatusCount[];
  totalApps: number;
  approvalRate: number;
  trend: TrendPoint[];
  byDepartment: DeptRow[];
  sizeBands: SizeBand[];
  productPerf: PerfRow[];
  avgDecisionDays: number;
  rejectionsByStage: RejectionRow[];
  currency: string;
  collections: { label: string; month: string; expected: number; collected: number; current: boolean }[];
}) {
  const ugx = (n: number) => formatMoney(n, currency);
  const avgLoan = book.activeLoans > 0 ? book.principalDisbursed / book.activeLoans : 0;
  const maxBand = Math.max(...sizeBands.map((b) => b.n), 1);
  const donutData = statusCounts.map((s) => ({ name: label(s.status), value: s.n, key: s.status }));

  // Status codes are fixed, code-level identifiers (safe as CSS custom-
  // property keys), unlike free-text product/department names elsewhere —
  // so this donut gets full config-driven colouring via chart.tsx.
  const statusChartConfig = Object.fromEntries(
    Object.entries(STATUS_COLOR).map(([status, color]) => [status, { label: label(status), color }]),
  ) satisfies ChartConfig;


  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-xl font-semibold text-ink">Analytics</h1>
        <p className="mt-1 text-sm text-ink-soft">Portfolio and application insights across the book.</p>
      </div>

      {/* KPI strip */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <Metric label="Applications" value={<CountUp value={totalApps} />} sub="All time" icon={FileText} accent="brand" />
        <Metric label="Approval rate" value={<CountUp value={approvalRate} format="percent" />} sub="Of all applications" icon={CheckCircle} accent="approved" />
        <Metric label="Avg. decision time" value={<CountUp value={avgDecisionDays} format="days" />} sub="Submission to final decision" icon={Clock3} accent="brand" />
        <Metric label="Portfolio" value={<CountUp value={book.totalExposure} format="money" currency={currency} />} sub={book.activeLoans + " active loans"} icon={Wallet} accent="brand" />
        <Metric label="Avg loan size" value={<CountUp value={avgLoan} format="money" currency={currency} />} sub="Per active loan" icon={Layers} accent="brand" />
      </section>

      {/* Collections: a full year of money in vs instalments due. */}
      <TrendLineChart
        title="Collections"
        subtitle={`Money received against instalments due, last 12 months · ${currency}`}
        data={collections}
        actual={{ key: "collected", label: "Collected", color: "var(--color-brand)" }}
        target={{ key: "expected", label: "Expected", color: "var(--color-chart-target)" }}
        currency={currency}
        markerX={collections.find((c) => c.current)?.label}
        compareNote="vs expected"
        emptyText="No instalments fell due in the last twelve months, so there's nothing to compare yet."
        csvName="collections-12-months"
        reportHref="/reports"
      />

      {/* Trend + status */}
      <section className="grid gap-4 lg:grid-cols-3">
        {/* Trend */}
        <TrendLineChart
          title="Applications over time"
          data={trend}
          actual={{ key: "approved", label: "Approved", color: "var(--color-brand)" }}
          target={{ key: "total", label: "Applied", color: "var(--color-chart-target)" }}
          format="count"
          showDelta={false}
          emptyText={
            trend.length === 1
              ? `${trend[0].total} application${trend[0].total === 1 ? "" : "s"} in ${trend[0].label}. The trend line appears once there's more than one month of history.`
              : "No applications yet."
          }
          csvName="applications-by-month"
          className="lg:col-span-2"
        />

        {/* Status donut */}
        <DashboardCard title="By status">
          {donutData.length === 0 ? (
            <p className="text-sm text-ink-soft">No data.</p>
          ) : (
            <>
              <ChartContainer config={statusChartConfig} className="aspect-auto h-[160px] w-full">
                <PieChart>
                  <Pie data={donutData} dataKey="value" nameKey="key" innerRadius={45} outerRadius={70} paddingAngle={2}>
                    {donutData.map((d) => <Cell key={d.key} fill={`var(--color-${d.key})`} />)}
                  </Pie>
                  <ChartTooltip content={<ChartTooltipContent nameKey="key" hideLabel />} />
                </PieChart>
              </ChartContainer>
              {/* Kept as a custom list rather than ChartLegendContent — this
                  shows the count per status, which the stock legend doesn't. */}
              <ul className="mt-3 space-y-1.5">
                {donutData.map((d) => (
                  <li key={d.key} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[d.key] ?? "#98a2b3" }} />
                      <span className="text-ink-soft">{d.name}</span>
                    </span>
                    <span className="num font-medium text-ink">{d.value}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </DashboardCard>
      </section>

      {/* Book by product + department + rejection bottlenecks */}
      <section className="grid gap-4 lg:grid-cols-3">
        {mix.length > 0 ? <ProductBars data={mix} currency={currency} /> : null}
        {/* Department bars */}
        <DashboardCard title="Exposure by department">
          {byDepartment.length === 0 ? (
            <p className="text-sm text-ink-soft">No active loans.</p>
          ) : (
            <div className="space-y-4">
              {byDepartment.map((d) => {
                const max = Math.max(...byDepartment.map((x) => x.principal), 1);
                const width = Math.max((d.principal / max) * 100, 2);
                return (
                  <div key={d.name}>
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="text-sm font-medium text-ink">{d.name}</span>
                      <span className="num text-sm text-ink">{ugx(d.principal)}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{ width: width + "%", background: "linear-gradient(90deg, var(--color-brand-300), var(--color-brand-600))" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DashboardCard>

        {/* Rejections by stage — a bottleneck finder: where in the pipeline
            applications actually die, not just how many. */}
        <DashboardCard title="Rejections by stage">
          {rejectionsByStage.length === 0 ? (
            <p className="text-sm text-ink-soft">No rejections yet.</p>
          ) : (
            <div className="space-y-4">
              {rejectionsByStage.map((r) => {
                const max = Math.max(...rejectionsByStage.map((x) => x.n), 1);
                const width = Math.max((r.n / max) * 100, 2);
                return (
                  <div key={r.stageRole}>
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="text-sm font-medium text-ink">{label(r.stageRole)}</span>
                      <span className="num text-sm text-ink">{r.n}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{ width: width + "%", background: "linear-gradient(90deg, var(--color-error-200), var(--color-rejected))" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DashboardCard>
      </section>

      {/* Size distribution */}
      <DashboardCard title="Loan size distribution">
        {sizeBands.length === 0 ? (
          <p className="text-sm text-ink-soft">No active loans.</p>
        ) : (
          <div className="flex items-end justify-between gap-3" style={{ height: 160 }}>
            {sizeBands.map((b) => (
              <div key={b.band} className="flex flex-1 flex-col items-center justify-end gap-2">
                <span className="num text-sm font-semibold text-ink">{b.n}</span>
                <div
                  className="w-full rounded-t-lg transition-all duration-700 ease-out"
                  style={{
                    height: Math.max((b.n / maxBand) * 120, 4) + "px",
                    background: "linear-gradient(180deg, var(--color-brand-400), var(--color-brand-700))",
                  }}
                />
                <span className="text-xs text-ink-soft">{b.band}</span>
              </div>
            ))}
          </div>
        )}
      </DashboardCard>

      {/* Product performance table */}
      <section className="overflow-x-auto rounded-2xl border border-rule bg-surface shadow-theme-xs">
        <div className="caps px-5 pt-4">Product performance</div>
        <table className="ledger mt-2">
          <thead>
            <tr>
              <th>Product</th>
              <th className="r">Applications</th>
              <th className="r">Avg amount</th>
              <th className="r">Approval rate</th>
            </tr>
          </thead>
          <tbody>
            {productPerf.map((p) => (
              <tr key={p.product}>
                <td className="font-medium text-ink">{p.product}</td>
                <td className="r num text-ink-soft">{p.apps}</td>
                <td className="r num text-ink">{p.avgAmount > 0 ? ugx(p.avgAmount) : "-"}</td>
                <td className="r num font-semibold text-brand-700">{p.apps > 0 ? p.approvalRate + "%" : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
