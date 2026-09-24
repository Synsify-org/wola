"use client";
// apps/web/src/components/trend-line-chart.tsx
// Two-series trend card — a solid line over a soft area (the actual) and a
// dashed line (the thing it's measured against), hollow dots, a dashed grid
// and a marker on the current period. Used for "Collected vs Expected" on the
// finance dashboards and "Applications vs Approved" in analytics.
//
// Built on the project's own ui/chart.tsx (shadcn's ChartContainer), so the
// tooltip/legend chrome and --color-<key> variables stay consistent with
// every other chart. The actual series takes the tenant's brand colour.
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import { Download, FileBarChart, MoreHorizontal } from "lucide-react";
import { formatMoney } from "@wola/engine";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import DashboardCard from "./dashboard-card";
import { DeltaPill } from "./metric";

export type TrendSeries = { key: string; label: string; color: string };
type Row = Record<string, string | number | boolean>;

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Hollow ring + label — the legend chip, reused inside the tooltip. */
function SeriesChip({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-3 shrink-0 rounded-full border-[3px] bg-surface" style={{ borderColor: color }} aria-hidden />
      <span className="text-ink-soft">{label}</span>
    </span>
  );
}

export default function TrendLineChart({
  title,
  subtitle,
  data,
  xKey = "label",
  actual,
  target,
  format = "money",
  currency = "UGX",
  markerX,
  compareNote = "vs target",
  showDelta = true,
  emptyText = "Nothing to chart yet.",
  csvName,
  reportHref,
  className = "",
}: {
  title: string;
  subtitle?: string;
  data: Row[];
  xKey?: string;
  /** Solid line + area: what actually happened. */
  actual: TrendSeries;
  /** Dashed line: what it's measured against. */
  target: TrendSeries;
  format?: "money" | "count";
  currency?: string;
  /** x value to mark with a vertical line (usually the current period). */
  markerX?: string;
  /** Tooltip pill caption, e.g. "vs expected". */
  compareNote?: string;
  /** Show the actual-vs-target % pill in the tooltip. Off where the two
   *  series are a ratio (approved of applied), not a shortfall. */
  showDelta?: boolean;
  emptyText?: string;
  /** Adds "Download CSV" to the card menu with this file name. */
  csvName?: string;
  /** Adds "Open reports" to the card menu. */
  reportHref?: string;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const reduced = usePrefersReducedMotion();
  const fmt = (v: number) => (format === "money" ? formatMoney(v, currency) : v.toLocaleString("en"));
  const hasData = data.length >= 2 && data.some((d) => Number(d[actual.key]) > 0 || Number(d[target.key]) > 0);

  const config = {
    [actual.key]: { label: actual.label, color: actual.color },
    [target.key]: { label: target.label, color: target.color },
  } satisfies ChartConfig;

  const downloadCsv = () => {
    const head = [xKey, actual.key, target.key].join(",");
    const body = data.map((d) => [JSON.stringify(String(d[xKey])), d[actual.key], d[target.key]].join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([head + "\n" + body + "\n"], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${csvName}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const menu =
    csvName || reportHref ? (
      <DropdownMenu>
        <DropdownMenuTrigger
          className="-me-1.5 grid h-8 w-8 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          aria-label={`${title} options`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {csvName ? (
            <DropdownMenuItem onSelect={downloadCsv} className="cursor-pointer">
              <Download className="mr-2 h-4 w-4" /> Download CSV
            </DropdownMenuItem>
          ) : null}
          {reportHref ? (
            <DropdownMenuItem asChild>
              <Link href={reportHref} className="cursor-pointer">
                <FileBarChart className="mr-2 h-4 w-4" /> Open reports
              </Link>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  return (
    <DashboardCard
      title={title}
      className={className}
      action={
        <div className="flex items-center gap-3 text-sm sm:gap-4">
          <SeriesChip label={actual.label} color={actual.color} />
          <SeriesChip label={target.label} color={target.color} />
          {menu}
        </div>
      }
    >
      {subtitle ? <p className="-mt-3 mb-4 text-[0.8125rem] text-ink-soft">{subtitle}</p> : null}
      {!hasData ? (
        <div className="grid h-[240px] place-items-center text-center sm:h-[300px]">
          <p className="max-w-xs text-sm text-ink-soft">{emptyText}</p>
        </div>
      ) : (
        <ChartContainer
          config={config}
          className="-ml-2 aspect-auto h-[240px] w-[calc(100%+0.5rem)] sm:h-[300px] [&_.recharts-cartesian-axis-tick_text]:fill-ink-faint"
        >
          <ComposedChart data={data} margin={{ top: 10, right: 12, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id={`fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={actual.color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={actual.color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 4" stroke="var(--color-rule)" vertical={false} />
            <XAxis
              dataKey={xKey}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11 }}
              tickMargin={12}
              interval="preserveStartEnd"
              minTickGap={12}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11 }}
              tickMargin={8}
              width={format === "money" ? 52 : 32}
              allowDecimals={format !== "count"}
              tickFormatter={(v: number) => (format === "money" ? compact.format(v) : String(v))}
            />
            {markerX ? <ReferenceLine x={markerX} stroke={actual.color} strokeOpacity={0.6} strokeWidth={1} /> : null}
            <ChartTooltip
              cursor={{ stroke: "var(--color-rule)", strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as Row;
                const a = Number(row[actual.key]);
                const t = Number(row[target.key]);
                const delta =
                  showDelta && t > 0
                    ? { dir: (a >= t ? "up" : "down") as "up" | "down", pct: Math.round(Math.abs(((a - t) / t) * 100)), note: compareNote }
                    : null;
                return (
                  <div className="min-w-[12rem] rounded-xl border border-rule bg-surface p-3 text-xs shadow-theme-lg">
                    <div className="mb-2.5 font-medium text-ink-soft">
                      {String(label)}
                      {markerX && label === markerX ? " · in progress" : ""}
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <SeriesChip label={actual.label} color={actual.color} />
                        <span className="flex items-center gap-1.5">
                          <span className="num font-semibold text-ink">{fmt(a)}</span>
                          {delta ? <DeltaPill delta={delta} /> : null}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <SeriesChip label={target.label} color={target.color} />
                        <span className="num font-semibold text-ink">{fmt(t)}</span>
                      </div>
                    </div>
                  </div>
                );
              }}
            />
            {/* Area has no stroke of its own: the Line on top draws the edge
                and the dots, so the fill never double-strokes. */}
            <Area
              type="linear"
              dataKey={actual.key}
              stroke="transparent"
              fill={`url(#fill-${uid})`}
              isAnimationActive={!reduced}
              tooltipType="none"
              activeDot={false}
            />
            <Line
              type="linear"
              dataKey={actual.key}
              stroke={actual.color}
              strokeWidth={2}
              dot={{ r: 5, strokeWidth: 2, fill: "var(--color-surface)", stroke: actual.color }}
              activeDot={{ r: 6, strokeWidth: 2, fill: "var(--color-surface)", stroke: actual.color }}
              isAnimationActive={!reduced}
            />
            <Line
              type="linear"
              dataKey={target.key}
              stroke={target.color}
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={{ r: 5, strokeWidth: 2, fill: "var(--color-surface)", stroke: target.color, strokeDasharray: "0" }}
              activeDot={{ r: 6, strokeWidth: 2, fill: "var(--color-surface)", stroke: target.color, strokeDasharray: "0" }}
              isAnimationActive={!reduced}
              animationBegin={150}
            />
          </ComposedChart>
        </ChartContainer>
      )}
    </DashboardCard>
  );
}
