"use client";
import { PieChart, Pie, Cell } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import DashboardCard from "./dashboard-card";
import CountUp from "./count-up";
import { DeltaPill } from "./metric";
import { formatMoney } from "@wola/engine";

// Product names are free-text tenant config, not safe CSS custom-property
// keys (spaces, arbitrary characters) — so this stays on direct Cell fill
// colours rather than the config-driven --color-{key} pattern chart.tsx
// supports. ChartContainer/ChartTooltip are still worth it for the
// consistent, theme-matched tooltip chrome (bg-background/border-border,
// automatically tracking Theme B — no more hand-written contentStyle).
const chartConfig = {} satisfies ChartConfig;

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
  currency,
}: {
  data: Row[];
  total: number;
  /** Real period-over-period change; omit rather than fabricate one. */
  delta?: { dir: "up" | "down"; pct: number; note: string };
  currency: string;
}) {
  const ugx = (n: number) => formatMoney(n, currency);
  const rows = data
    .map((d) => ({ ...d, principal: Number(d.principal) }))
    .sort((a, b) => b.principal - a.principal);

  return (
    <DashboardCard title="Book breakup">
      {/* Stacked until the CARD (not the viewport) is wide enough for the
          donut to sit beside the total — a container query, because this card
          lives in a 1/3 column on some dashboards and a 1/2 on others, so no
          viewport breakpoint is right for both. */}
      <div className="@container">
      <div className="flex flex-col items-start gap-5 @[24rem]:flex-row @[24rem]:items-center @[24rem]:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="num whitespace-nowrap text-2xl font-semibold leading-none tracking-tight text-ink" title={ugx(total)}>
              <CountUp value={total} format="money" currency={currency} />
            </span>
            {delta ? <DeltaPill delta={delta} /> : null}
          </div>
          {delta ? <p className="mt-2 text-[0.8125rem] text-ink-soft">{delta.note}</p> : null}

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

        <div className="h-32 w-32 shrink-0 self-center">
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
      </div>
    </DashboardCard>
  );
}
