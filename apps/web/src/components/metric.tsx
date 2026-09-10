// apps/web/src/components/metric.tsx
// A dashboard KPI: icon chip, dominant number, quiet label, optional trend.
// Subtle hover lift for tactility.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

export default function Metric({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  trend,
}: {
  label: string;
  /** Usually a formatted string; a ReactNode is accepted so callers can pass
   *  an animated number (see CountUp) without Metric knowing about it. */
  value: ReactNode;
  sub?: string;
  icon?: LucideIcon;
  accent?: "awaiting" | "approved" | "rejected" | "brand";
  /** Real period-over-period change. Omit rather than fabricate one when
   *  there's nothing honest to compare against. Same shape as FeaturedMetric
   *  and BookBreakup's delta prop. */
  trend?: { dir: "up" | "down"; pct: number; note: string };
}) {
  const chip =
    accent === "awaiting" ? "bg-warning-100 text-warning-700"
    : accent === "approved" ? "bg-success-100 text-success-700"
    : accent === "rejected" ? "bg-error-100 text-error-700"
    : "bg-brand-100 text-brand-700";

  return (
    <div className="group min-w-0 overflow-hidden rounded-xl border border-rule bg-surface p-5 shadow-theme-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-theme-md">
      <div className="flex items-start justify-between gap-2">
        <span className="caps">{label}</span>
        {Icon ? (
          <span className={"grid h-11 w-11 shrink-0 place-items-center rounded-xl transition-transform duration-200 group-hover:scale-105 " + chip}>
            <Icon className="h-5 w-5" strokeWidth={2} />
          </span>
        ) : null}
      </div>
      <div className="num mt-3 truncate text-2xl font-bold leading-tight text-ink" title={typeof value === "string" ? value : undefined}>
        {value}
      </div>
      <div className="mt-1 flex items-center gap-2">
        {trend ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              className={
                "grid h-5 w-5 shrink-0 place-items-center rounded-full " +
                (trend.dir === "up" ? "bg-success-100 text-success-700" : "bg-error-100 text-error-700")
              }
            >
              {trend.dir === "up" ? (
                <ArrowUpRight className="h-3 w-3" strokeWidth={2.5} />
              ) : (
                <ArrowDownRight className="h-3 w-3" strokeWidth={2.5} />
              )}
            </span>
            <span className="num text-xs font-semibold text-ink">{Math.abs(trend.pct)}%</span>
            <span className="text-xs text-ink-soft">{trend.note}</span>
          </span>
        ) : sub ? (
          <span className="text-xs text-ink-soft">{sub}</span>
        ) : null}
      </div>
    </div>
  );
}
