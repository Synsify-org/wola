"use client";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { formatMoney } from "@wola/engine";
import DashboardCard from "./dashboard-card";

export type SizeBand = { band: string; n: number; principal: number };

const config = { n: { label: "Loans", color: "var(--color-brand)" } } satisfies ChartConfig;

/** Active loans bucketed by principal. Every band is drawn — including empty
 *  ones — so the shape of the book reads at a glance; a histogram that skips
 *  the empty buckets misleads about where the gaps are. */
export default function LoanSizeChart({ bands, currency }: { bands: SizeBand[]; currency: string }) {
  const totalLoans = bands.reduce((s, b) => s + b.n, 0);
  const totalPrincipal = bands.reduce((s, b) => s + b.principal, 0);
  const modal = bands.reduce<SizeBand | null>((best, b) => (b.n > (best?.n ?? 0) ? b : best), null);

  return (
    <DashboardCard title="Loan size distribution">
      {totalLoans === 0 ? (
        <p className="text-sm text-ink-soft">No active loans.</p>
      ) : (
        <>
          <ChartContainer config={config} className="aspect-auto h-[240px] w-full">
            <BarChart data={bands} margin={{ top: 22, right: 8, left: -12, bottom: 0 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--color-rule)" />
              <XAxis
                dataKey="band"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12, fill: "var(--color-ink-soft)" }}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={36}
                tick={{ fontSize: 12, fill: "var(--color-ink-faint)" }}
              />
              <ChartTooltip
                cursor={{ fill: "var(--color-brand-50)" }}
                content={({ active, payload }) => {
                  const b = payload?.[0]?.payload as SizeBand | undefined;
                  if (!active || !b) return null;
                  const share = totalPrincipal > 0 ? Math.round((b.principal / totalPrincipal) * 100) : 0;
                  return (
                    <div className="rounded-lg border border-rule bg-surface px-3 py-2 text-xs shadow-theme-md">
                      <div className="font-semibold text-ink">{b.band}</div>
                      <div className="mt-1 text-ink-soft">
                        <span className="num font-medium text-ink">{b.n}</span> loan{b.n === 1 ? "" : "s"}
                      </div>
                      <div className="text-ink-soft">
                        <span className="num font-medium text-ink">{formatMoney(b.principal, currency)}</span> principal
                        {" · "}
                        <span className="num">{share}%</span> of book
                      </div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="n" fill="var(--color-brand)" radius={[6, 6, 0, 0]} maxBarSize={56} isAnimationActive animationDuration={700}>
                <LabelList
                  dataKey="n"
                  position="top"
                  className="num"
                  fill="var(--color-ink)"
                  fontSize={12}
                  fontWeight={600}
                  formatter={(v: unknown) => (Number(v) > 0 ? String(v) : "")}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
          {modal ? (
            <p className="mt-3 text-xs text-ink-soft">
              Most loans sit in <span className="font-medium text-ink">{modal.band}</span> ({modal.n} of {totalLoans}
              active loans). Hover a bar for the principal behind it.
            </p>
          ) : null}
        </>
      )}
    </DashboardCard>
  );
}
