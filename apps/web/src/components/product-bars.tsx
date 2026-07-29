"use client";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();

// Forest-brand ramp - deepest for the largest book, never state colours.
const RAMP = ["#064E3B", "#1B5E4B", "#40916C", "#74C69D", "#B7E4C7"];

type Row = { name: string; kind: string; n: number; principal: number };

export default function ProductBars({ data }: { data: Row[] }) {
  // Coerce: postgres numeric arrives as a string. Sort largest first.
  const rows = data
    .map((d) => ({ ...d, principal: Number(d.principal), n: Number(d.n) }))
    .sort((a, b) => b.principal - a.principal);

  const max = Math.max(...rows.map((r) => r.principal), 1);
  const total = rows.reduce((s, r) => s + r.principal, 0);

  return (
    <div className="rounded-lg border border-rule bg-surface p-5 shadow-sm">
      <div className="caps mb-4">Book by product</div>
      <div className="space-y-4">
        {rows.map((r, i) => {
          const pct = total > 0 ? Math.round((r.principal / total) * 100) : 0;
          const width = Math.max((r.principal / max) * 100, 2);
          return (
            <div key={r.name}>
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-sm font-medium text-ink">{r.name}</span>
                <span className="num text-sm text-ink">{ugx(r.principal)}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: width + "%", background: RAMP[i % RAMP.length] }}
                  />
                </div>
                <span className="num w-16 text-right text-xs text-ink-soft">
                  {r.n} loan{r.n === 1 ? "" : "s"}
                </span>
                <span className="num w-10 text-right text-xs text-ink-faint">
                  {pct}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
