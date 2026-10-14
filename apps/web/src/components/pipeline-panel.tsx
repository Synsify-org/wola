"use client";
// Application pipeline: one segmented bar for the whole picture, then a row per stage
// (colour dot, name, "count · amount", a mini bar and the share). The shape comes from
// the sales-pipeline reference; the colours are our state colours, so a rejected stage
// reads as rejected, and the dots, bar segments and mini bars always agree.
import { formatMoney } from "@wola/engine";
import DashboardCard from "./dashboard-card";

type PipelineRow = { status: string; n: number; amount?: number };

// Ordered stages with their state-colour treatment.
const ORDER = [
  { key: "submitted", label: "Submitted", cls: "bg-awaiting" },
  { key: "in_review", label: "In review", cls: "bg-brand-400" },
  { key: "approved", label: "Approved", cls: "bg-approved" },
  { key: "rejected", label: "Rejected", cls: "bg-rejected" },
];

export default function PipelinePanel({ data, currency }: { data: PipelineRow[]; currency?: string }) {
  const by: Record<string, PipelineRow> = {};
  for (const r of data) by[r.status] = r;
  const total = data.reduce((s, r) => s + r.n, 0);
  const money = (n: number) => (currency ? formatMoney(n, currency) : String(n));
  const hasAmounts = Boolean(currency) && data.some((r) => (r.amount ?? 0) > 0);

  return (
    <DashboardCard title="Application pipeline">
      {total === 0 ? (
        <p className="text-sm text-ink-soft">No applications yet.</p>
      ) : (
        <div className="space-y-5">
          {/* The whole pipeline at a glance. */}
          <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-gray-100" role="img"
            aria-label={ORDER.map((s) => `${s.label} ${by[s.key]?.n ?? 0}`).join(", ")}>
            {ORDER.map((s) => {
              const n = by[s.key]?.n ?? 0;
              return n > 0 ? <div key={s.key} className={s.cls} style={{ width: `${(n / total) * 100}%` }} /> : null;
            })}
          </div>

          <ul className="space-y-3.5">
            {ORDER.map((s) => {
              const row = by[s.key];
              const n = row?.n ?? 0;
              const pct = Math.round((n / total) * 100);
              return (
                <li key={s.key} className="flex items-center gap-3">
                  <span className={`h-3 w-3 shrink-0 rounded-full ${s.cls} ${n === 0 ? "opacity-30" : ""}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">{s.label}</div>
                    <div className="num text-xs text-ink-soft">
                      {n} {n === 1 ? "application" : "applications"}{hasAmounts ? ` · ${money(row?.amount ?? 0)}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-gray-100 min-[420px]:block">
                      <div className={`h-full rounded-full transition-all duration-500 ease-out ${s.cls}`} style={{ width: `${Math.max(pct, n > 0 ? 4 : 0)}%` }} />
                    </div>
                    <span className="num w-9 text-right text-sm text-ink-soft">{pct}%</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </DashboardCard>
  );
}
