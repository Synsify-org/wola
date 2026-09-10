"use client";
import {
  PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, type ChartConfig } from "@/components/ui/chart";
import Metric from "./metric";
import ProductBars from "./product-bars";
import DashboardCard from "./dashboard-card";
import CountUp from "./count-up";
import { FileText, CheckCircle, Wallet, Layers, Clock3 } from "lucide-react";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();

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
  avgDecisionDays, rejectionsByStage,
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
}) {
  const avgLoan = book.activeLoans > 0 ? book.principalDisbursed / book.activeLoans : 0;
  const maxBand = Math.max(...sizeBands.map((b) => b.n), 1);
  const donutData = statusCounts.map((s) => ({ name: label(s.status), value: s.n, key: s.status }));

  // Status codes are fixed, code-level identifiers (safe as CSS custom-
  // property keys), unlike free-text product/department names elsewhere —
  // so this donut gets full config-driven colouring via chart.tsx.
  const statusChartConfig = Object.fromEntries(
    Object.entries(STATUS_COLOR).map(([status, color]) => [status, { label: label(status), color }]),
  ) satisfies ChartConfig;

  const trendChartConfig = {
    total: { label: "Applications", color: "var(--color-gray-400)" },
    approved: { label: "Approved", color: "var(--color-approved)" },
  } satisfies ChartConfig;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-xl font-semibold text-ink">Analytics</h1>
        <p className="mt-1 text-sm text-ink-soft">Portfolio and application insights across the book.</p>
      </div>

      {/* KPI strip */}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <Metric label="Applications" value={<CountUp value={totalApps} />} sub="All time" icon={FileText} accent="brand" />
        <Metric label="Approval rate" value={<CountUp value={approvalRate} format={(n) => Math.round(n) + "%"} />} sub="Of all applications" icon={CheckCircle} accent="approved" />
        <Metric label="Avg. decision time" value={<CountUp value={avgDecisionDays} format={(n) => n.toFixed(1) + "d"} />} sub="Submission to final decision" icon={Clock3} accent="brand" />
        <Metric label="Portfolio" value={<CountUp value={book.totalExposure} format={(n) => ugx(n)} />} sub={book.activeLoans + " active loans"} icon={Wallet} accent="brand" />
        <Metric label="Avg loan size" value={<CountUp value={avgLoan} format={(n) => ugx(n)} />} sub="Per active loan" icon={Layers} accent="brand" />
      </section>

      {/* Trend + status */}
      <section className="grid gap-4 lg:grid-cols-3">
        {/* Trend */}
        <div className="lg:col-span-2">
        <DashboardCard title="Applications over time">
          {trend.length === 0 ? (
            <p className="text-sm text-ink-soft">No applications yet.</p>
          ) : trend.length === 1 ? (
            // A line/area chart needs 2+ points to draw anything — with one
            // month of history it collapses to a lone dot in empty gridlines,
            // which reads as broken rather than "not enough data yet".
            <div className="flex h-[260px] flex-col items-center justify-center text-center">
              <div className="num text-3xl font-bold text-ink">{trend[0].total}</div>
              <p className="mt-1 text-sm text-ink-soft">applications in {trend[0].label}</p>
              <p className="mt-3 max-w-xs text-xs text-ink-faint">
                The trend line appears once there&apos;s more than one month of history.
              </p>
            </div>
          ) : (
            <ChartContainer config={trendChartConfig} className="aspect-auto h-[260px] w-full">
              <AreaChart data={trend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="totalFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-total)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--color-total)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="approvedFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-approved)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="var(--color-approved)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-rule)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--color-ink-faint)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "var(--color-ink-faint)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Area type="monotone" dataKey="total" stroke="var(--color-total)" fill="url(#totalFill)" strokeWidth={2} dot={{ r: 3 }} animationDuration={900} />
                <Area type="monotone" dataKey="approved" stroke="var(--color-approved)" fill="url(#approvedFill)" strokeWidth={2} dot={{ r: 3 }} animationDuration={900} animationBegin={150} />
              </AreaChart>
            </ChartContainer>
          )}
        </DashboardCard>
        </div>

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
        {mix.length > 0 ? <ProductBars data={mix} /> : null}
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
      <section className="overflow-hidden rounded-xl border border-rule bg-surface shadow-theme-sm">
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
