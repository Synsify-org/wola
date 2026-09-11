"use client";
import { PieChart, Pie, Cell } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import DashboardCard from "./dashboard-card";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

// Product names are free-text tenant config, not safe CSS custom-property
// keys (spaces, arbitrary characters) — so this stays on direct Cell fill
// colours rather than the config-driven --color-{key} pattern chart.tsx
// supports. ChartContainer/ChartTooltip are still worth it for the
// consistent, theme-matched tooltip chrome (bg-background/border-border,
// automatically tracking Theme B — no more hand-written contentStyle).
const chartConfig = {} satisfies ChartConfig;

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();

// Brand ramp for slices — never the state colours (those mean
// approved/rejected, not product). CSS vars so a tenant's white-label
// brand colour flows through automatically.
const COLORS = [
  "var(--color-brand-800)",
  "var(--color-brand-600)",
  "var(--color-brand-400)",
  "var(--color-brand-300)",
  "var(--color-brand-200)",
];

type Row = { name: string; principal: number };

export default function BookBreakup({
  data,
  total,
  delta,
}: {
  data: Row[];
  total: number;
  /** Real period-over-period change; omit rather than fabricate one. */
  delta?: { dir: "up" | "down"; pct: number; note: string };
}) {
  const rows = data
    .map((d) => ({ ...d, principal: Number(d.principal) }))
    .sort((a, b) => b.principal - a.principal);

  return (
    <DashboardCard title="Book breakup">
      {/* Stacked until there's genuinely enough width for the donut to sit
          beside the total without squeezing it — sharing a row at exactly
          the outer grid's own lg: breakpoint (1024px) is what caused the
          total to truncate (confirmed live: "UGX 83..."). */}
      <div className="flex flex-col items-start gap-4 xl:flex-row xl:items-center xl:gap-6">
        <div className="min-w-0 flex-1">
          <div className="num truncate text-2xl font-bold leading-tight text-ink" title={ugx(total)}>{ugx(total)}</div>
          {delta ? (
            <div className="mt-2 flex items-center gap-1.5">
              <span
                className={
                  "grid h-5 w-5 shrink-0 place-items-center rounded-full " +
                  (delta.dir === "up" ? "bg-success-100 text-success-700" : "bg-error-100 text-error-700")
                }
              >
                {delta.dir === "up" ? (
                  <ArrowUpRight className="h-3 w-3" strokeWidth={2.5} />
                ) : (
                  <ArrowDownRight className="h-3 w-3" strokeWidth={2.5} />
                )}
              </span>
              <span className="num text-xs font-semibold text-ink">{Math.abs(delta.pct)}%</span>
              <span className="text-xs text-ink-soft">{delta.note}</span>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2">
            {rows.slice(0, 5).map((r, i) => (
              <div key={r.name} className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: COLORS[i % COLORS.length] }}
                />
                <span className="truncate text-xs text-ink-soft">{r.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="h-32 w-32 shrink-0">
          <ChartContainer config={chartConfig} className="aspect-square h-full w-full">
            <PieChart>
              <Pie
                data={rows}
                dataKey="principal"
                nameKey="name"
                innerRadius={38}
                outerRadius={62}
                paddingAngle={2}
                strokeWidth={0}
              >
                {rows.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <ChartTooltip content={<ChartTooltipContent formatter={(value) => ugx(Number(value))} hideLabel />} />
            </PieChart>
          </ChartContainer>
        </div>
      </div>
    </DashboardCard>
  );
}
