"use client";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";
import Metric from "./metric";
import ProductBars from "./product-bars";
import { FileText, CheckCircle, Wallet, Layers } from "lucide-react";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();
const compact = (n: number) => {
  if (n >= 1_000_000) return "UGX " + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return "UGX " + (n / 1_000).toFixed(0) + "K";
  return "UGX " + Math.round(n);
};

type Book = { totalExposure: number; activeLoans: number; principalDisbursed: number; interestBook: number };
type StatusCount = { status: string; n: number };
type TrendPoint = { label: string; total: number; approved: number };
type DeptRow = { name: string; kind?: string; n: number; principal: number };
type SizeBand = { band: string; n: number };
type PerfRow = { product: string; apps: number; avgAmount: number; approvalRate: number };

const STATUS_COLOR: Record<string, string> = {
  approved: "#027a48",
  submitted: "#b54708",
  in_review: "#2e90fa",
  rejected: "#b42318",
};
const label = (r: string) => r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function AnalyticsView({
  book, mix, statusCounts, totalApps, approvalRate, trend, byDepartment, sizeBands, productPerf,
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
}) {
  const avgLoan = book.activeLoans > 0 ? book.principalDisbursed / book.activeLoans : 0;
  const maxBand = Math.max(...sizeBands.map((b) => b.n), 1);
  const donutData = statusCounts.map((s) => ({ name: label(s.status), value: s.n, key: s.status }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Analytics</h1>
        <p className="mt-1 text-sm text-ink-soft">Portfolio and application insights across the book.</p>
      </div>

      {/* KPI strip */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Applications" value={String(totalApps)} sub="All time" icon={FileText} accent="brand" />
        <Metric label="Approval rate" value={approvalRate + "%"} sub="Of all applications" icon={CheckCircle} accent="approved" />
        <Metric label="Portfolio" value={ugx(book.totalExposure)} sub={book.activeLoans + " active loans"} icon={Wallet} accent="brand" />
        <Metric label="Avg loan size" value={ugx(avgLoan)} sub="Per active loan" icon={Layers} accent="brand" />
      </section>

      {/* Trend + status */}
      <section className="grid gap-4 lg:grid-cols-3">
        {/* Trend */}
        <div className="rounded-xl border border-rule bg-surface p-5 shadow-theme-sm lg:col-span-2">
          <div className="caps mb-4">Applications over time</div>
          {trend.length === 0 ? (
            <p className="text-sm text-ink-soft">No applications yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={trend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e7ec" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#98a2b3" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "#98a2b3" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e4e7ec", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="total" name="Applications" stroke="#98a2b3" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="approved" name="Approved" stroke="#027a48" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Status donut */}
        <div className="rounded-xl border border-rule bg-surface p-5 shadow-theme-sm">
          <div className="caps mb-4">By status</div>
          {donutData.length === 0 ? (
            <p className="text-sm text-ink-soft">No data.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
                    {donutData.map((d) => <Cell key={d.key} fill={STATUS_COLOR[d.key] ?? "#98a2b3"} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e4e7ec", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
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
        </div>
      </section>

      {/* Book by product + department */}
      <section className="grid gap-4 lg:grid-cols-2">
        {mix.length > 0 ? <ProductBars data={mix as never[]} /> : null}
        {/* Department bars */}
        <div className="rounded-xl border border-rule bg-surface p-5 shadow-theme-sm">
          <div className="caps mb-5">Exposure by department</div>
          {byDepartment.length === 0 ? (
            <p className="text-sm text-ink-soft">No active loans.</p>
          ) : (
            <div className="space-y-4">
              {byDepartment.map((d, i) => {
                const max = Math.max(...byDepartment.map((x) => x.principal), 1);
                const width = Math.max((d.principal / max) * 100, 2);
                return (
                  <div key={d.name}>
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="text-sm font-medium text-ink">{d.name}</span>
                      <span className="num text-sm text-ink">{ugx(d.principal)}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-info-500 transition-all duration-500" style={{ width: width + "%" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Size distribution */}
      <section className="rounded-xl border border-rule bg-surface p-5 shadow-theme-sm">
        <div className="caps mb-5">Loan size distribution</div>
        {sizeBands.length === 0 ? (
          <p className="text-sm text-ink-soft">No active loans.</p>
        ) : (
          <div className="flex items-end justify-between gap-3" style={{ height: 160 }}>
            {sizeBands.map((b) => (
              <div key={b.band} className="flex flex-1 flex-col items-center justify-end gap-2">
                <span className="num text-sm font-semibold text-ink">{b.n}</span>
                <div className="w-full rounded-t-lg bg-brand transition-all duration-500" style={{ height: Math.max((b.n / maxBand) * 120, 4) + "px" }} />
                <span className="text-xs text-ink-soft">{b.band}</span>
              </div>
            ))}
          </div>
        )}
      </section>

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
