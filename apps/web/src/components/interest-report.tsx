"use client";
// apps/web/src/components/interest-report.tsx
// The CFO's interest report on /reports: interest expected (from the schedules) vs
// interest collected (from the ledger) for a chosen range of months, by month and by
// product. Figures come from interestReport() in @wola/db; this only lays them out.
import Link from "next/link";
import { Download, Percent } from "lucide-react";
import { formatMoney } from "@wola/engine";
import type { InterestReport as Report } from "@wola/db";
import DashboardCard from "./dashboard-card";
import TrendLineChart from "./trend-line-chart";

export type RangePreset = { label: string; from: string; to: string };

function downloadCSV(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const blob = new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export default function InterestReport({
  report, presets, currency,
}: {
  report: Report;
  presets: RangePreset[];
  currency: string;
}) {
  const money = (n: number) => formatMoney(n, currency);
  const { months, byProduct, totals } = report;
  const rangeLabel = `${months[0]?.label ?? report.from} to ${months[months.length - 1]?.label ?? report.to}`;
  // Measured over finished months only: this month's deductions may simply not have run yet.
  const collectedRate = totals.expectedToDate > 0 ? Math.round((totals.collectedToDate / totals.expectedToDate) * 100) : null;
  const gapToDate = Math.round((totals.expectedToDate - totals.collectedToDate) * 100) / 100;
  const currentLabel = months.find((m) => m.current)?.label;

  const exportCsv = () =>
    downloadCSV(`wola-interest-${report.from}-to-${report.to}.csv`, [
      ["Month", "Interest expected", "Interest collected", "Gap"],
      ...months.map((m) => [m.month, m.expected, m.collected, m.future ? "" : Math.round((m.expected - m.collected) * 100) / 100]),
      [],
      ["Product", "Interest expected", "Interest collected"],
      ...byProduct.map((p) => [p.product, p.expected, p.collected]),
    ]);

  return (
    <section className="no-print mb-6 space-y-6" aria-labelledby="interest-report-title">
      <div className="rounded-2xl border border-rule bg-surface p-5 shadow-theme-xs sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
              <Percent className="h-5 w-5" />
            </span>
            <div>
              <h2 id="interest-report-title" className="text-lg font-semibold text-ink">Interest</h2>
              <p className="mt-0.5 text-sm text-ink-soft">
                Expected from the repayment schedules, collected from repayments received · {rangeLabel}
              </p>
            </div>
          </div>
          <button onClick={exportCsv} className="btn btn--ghost inline-flex items-center gap-1.5 rounded-full text-sm">
            <Download className="h-4 w-4" /> Download CSV
          </button>
        </div>

        {/* Range: quick picks, or any two months */}
        <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-rule pt-5">
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => {
              const on = p.from === report.from && p.to === report.to;
              return (
                <Link
                  key={p.label}
                  href={`/reports?from=${p.from}&to=${p.to}#interest-report-title`}
                  scroll={false}
                  aria-current={on ? "true" : undefined}
                  className={
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors " +
                    (on ? "border-brand bg-brand text-brand-ink" : "border-rule text-ink-soft hover:border-brand hover:text-brand")
                  }
                >
                  {p.label}
                </Link>
              );
            })}
          </div>
          <form method="get" action="/reports" className="ms-auto flex flex-wrap items-end gap-2">
            <label className="text-xs text-ink-soft">
              From
              <input type="month" name="from" defaultValue={report.from} required
                className="num mt-1 block h-9 rounded-lg border border-rule bg-surface px-2 text-sm text-ink outline-none focus:border-brand" />
            </label>
            <label className="text-xs text-ink-soft">
              To
              <input type="month" name="to" defaultValue={report.to} required
                className="num mt-1 block h-9 rounded-lg border border-rule bg-surface px-2 text-sm text-ink outline-none focus:border-brand" />
            </label>
            <button type="submit" className="btn btn--primary h-9 rounded-full text-sm">Show</button>
          </form>
        </div>

        {/* Headline figures for the range */}
        <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl bg-paper p-4">
            <dt className="caps">Interest expected</dt>
            <dd className="num mt-1 text-xl font-bold text-ink">{money(totals.expected)}</dd>
            <p className="mt-1 text-xs text-ink-soft">Due on the schedules in this range</p>
          </div>
          <div className="rounded-xl bg-paper p-4">
            <dt className="caps">Interest collected</dt>
            <dd className="num mt-1 text-xl font-bold text-ink">{money(totals.collected)}</dd>
            <p className="mt-1 text-xs text-ink-soft">
              {collectedRate === null ? "No finished months in this range yet" : `${collectedRate}% of what was due in finished months`}
            </p>
          </div>
          <div className="rounded-xl bg-paper p-4">
            <dt className="caps">Not yet collected</dt>
            <dd className={"num mt-1 text-xl font-bold " + (gapToDate > 0.5 ? "text-rejected" : "text-ink")}>
              {money(Math.max(0, gapToDate))}
            </dd>
            <p className="mt-1 text-xs text-ink-soft">Due in finished months but not received (missed or short)</p>
          </div>
          <div className="rounded-xl bg-paper p-4">
            <dt className="caps">Still to come</dt>
            <dd className="num mt-1 text-xl font-bold text-ink">{money(totals.expectedAhead)}</dd>
            <p className="mt-1 text-xs text-ink-soft">This month (in progress) and the months ahead</p>
          </div>
        </dl>
      </div>

      <TrendLineChart
        title="Interest by month"
        subtitle={`Collected against expected · ${currency}`}
        // Months ahead carry no "collected", so that line stops at this month instead of
        // dropping to zero.
        data={months.map(({ collected, ...rest }) => (rest.future ? rest : { ...rest, collected }))}
        actual={{ key: "collected", label: "Collected", color: "var(--color-brand)" }}
        target={{ key: "expected", label: "Expected", color: "var(--color-chart-target)" }}
        currency={currency}
        markerX={currentLabel}
        compareNote="vs expected"
        emptyText="No interest due or received in this range."
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[3fr_2fr]">
        <DashboardCard title="Month by month" flush>
          <div className="overflow-x-auto">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="r">Expected</th>
                  <th className="r">Collected</th>
                  <th className="r">Gap</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => {
                  const gap = Math.round((m.expected - m.collected) * 100) / 100;
                  return (
                    <tr key={m.month}>
                      <td className="text-sm text-ink">
                        {m.label}
                        {m.current ? <span className="chip chip--awaiting ms-2">This month</span> : null}
                      </td>
                      <td className="num r text-sm text-ink">{money(m.expected)}</td>
                      <td className="num r text-sm text-ink">{m.future ? "—" : money(m.collected)}</td>
                      <td className={"num r text-sm " + (!m.future && !m.current && gap > 0.5 ? "text-rejected" : "text-ink-soft")}>
                        {m.future ? "Upcoming" : m.current && gap > 0.5 ? `${money(gap)} to go` : gap > 0.5 ? money(gap) : gap < -0.5 ? `+${money(-gap)} ahead` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="text-sm font-semibold text-ink">Total</td>
                  <td className="num r text-sm font-semibold text-ink">{money(totals.expected)}</td>
                  <td className="num r text-sm font-semibold text-ink">{money(totals.collected)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </DashboardCard>

        <DashboardCard title="By product" flush>
          {byProduct.length === 0 ? (
            <p className="p-6 text-sm text-ink-soft">No interest due or received in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="r">Expected</th>
                    <th className="r">Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {byProduct.map((p) => (
                    <tr key={p.product}>
                      <td className="text-sm text-ink">{p.product}</td>
                      <td className="num r text-sm text-ink">{money(p.expected)}</td>
                      <td className="num r text-sm text-ink">{money(p.collected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DashboardCard>
      </div>
    </section>
  );
}
