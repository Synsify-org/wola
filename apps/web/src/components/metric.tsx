// apps/web/src/components/metric.tsx
// A dashboard KPI card: sentence-case title with a plain accent icon
// top-right, a dominant number with its period-over-period pill beside it,
// and one quiet context line underneath ("vs last month · 8 active loans").
// Static — no hover lift, because nothing here is clickable.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type Accent = "awaiting" | "approved" | "rejected" | "brand";
export type Delta = { dir: "up" | "down"; pct: number; note: string };

const ICON_TONE: Record<Accent, string> = {
  brand: "text-brand",
  awaiting: "text-warning-600",
  approved: "text-success-600",
  rejected: "text-error-600",
};

/** Small filled-triangle pill: green up, red down. Shared by every KPI card
 *  so the delta treatment is identical across all eight dashboards. */
export function DeltaPill({ delta }: { delta: Delta }) {
  const up = delta.dir === "up";
  return (
    <span
      title={delta.note}
      className={
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium " +
        (up ? "bg-success-100 text-success-700" : "bg-error-100 text-error-700")
      }
    >
      <svg viewBox="0 0 10 8" className={"h-2 w-2.5 fill-current " + (up ? "" : "rotate-180")} aria-hidden>
        <path d="M5 0l5 8H0z" />
      </svg>
      <span className="num">{Math.abs(delta.pct)}%</span>
      <span className="sr-only">{up ? "up" : "down"} {delta.note}</span>
    </span>
  );
}

export default function Metric({
  label,
  value,
  sub,
  icon: Icon,
  accent = "brand",
  trend,
}: {
  label: string;
  /** Usually a formatted string; a ReactNode is accepted so callers can pass
   *  an animated number (see CountUp) without Metric knowing about it. */
  value: ReactNode;
  sub?: string;
  icon?: LucideIcon;
  accent?: Accent;
  /** Real period-over-period change. Omit rather than fabricate one when
   *  there's nothing honest to compare against. */
  trend?: Delta;
}) {
  const context = [trend?.note, sub].filter(Boolean).join(" · ");

  return (
    <div className="@container flex min-w-0 flex-col rounded-2xl border border-rule bg-surface p-4 shadow-theme-xs sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[0.9375rem] font-medium leading-snug text-ink">{label}</span>
        {Icon ? <Icon className={"h-5 w-5 shrink-0 " + ICON_TONE[accent]} strokeWidth={2} aria-hidden /> : null}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 sm:mt-6">
        <span
          className="num text-xl font-semibold leading-tight tracking-tight text-ink @[12.5rem]:whitespace-nowrap @[12.5rem]:text-2xl @[12.5rem]:leading-none @[15rem]:text-[1.75rem]"
          title={typeof value === "string" ? value : undefined}
        >
          {value}
        </span>
        {trend ? <DeltaPill delta={trend} /> : null}
      </div>
      {context ? <p className="mt-2 text-[0.8125rem] text-ink-soft">{context}</p> : null}
    </div>
  );
}
