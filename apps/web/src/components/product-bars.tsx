"use client";
import DashboardCard from "./dashboard-card";
const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();

// Forest-brand ramp - deepest for the largest book, never state colours.
const RAMP = ["#064E3B", "#12583c", "#1b6b4a", "#40916c", "#6fae90"];

// kind is accepted but unused here; optional so both MixRow (kind: string)
// and DeptRow (kind?: string) satisfy this prop without a cast.
type Row = { name: string; kind?: string; n: number; principal: number };

export default function ProductBars({ data }: { data: Row[] }) {
  const rows = data
    .map((d) => ({ ...d, principal: Number(d.principal), n: Number(d.n) }))
    .sort((a, b) => b.principal - a.principal);
  const max = Math.max(...rows.map((r) => r.principal), 1);
  const total = rows.reduce((s, r) => s + r.principal, 0);

  return (
    <DashboardCard title="Book by product">
      <div className="space-y-5">
        {rows.map((r, i) => {
          const pct = total > 0 ? Math.round((r.principal / total) * 100) : 0;
          const width = Math.max((r.principal / max) * 100, 2);
          const color = RAMP[i % RAMP.length];
          return (
            <div key={r.name} className="group">
              <div className="mb-2 flex items-baseline justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: color }}
                  />
                  <span className="text-sm font-medium text-ink">{r.name}</span>
                  <span className="num text-xs text-ink-faint">
                    {r.n} loan{r.n === 1 ? "" : "s"}
                  </span>
                </div>
                <span className="num text-sm font-semibold text-ink">
                  {ugx(r.principal)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full transition-all duration-500 ease-out group-hover:brightness-110"
                    style={{ width: width + "%", background: color }}
                  />
                </div>
                <span className="num w-10 shrink-0 text-right text-xs font-medium text-ink-soft">
                  {pct}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </DashboardCard>
  );
}
