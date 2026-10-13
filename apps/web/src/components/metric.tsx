// apps/web/src/components/metric.tsx
// A dashboard KPI card. The look lives in stat-card.tsx (tinted tile, soft
// pattern, dominant number, period-over-period badge, "vs last month" footer);
// this wrapper keeps the call sites' API (label / value / sub / icon / accent /
// trend) stable. DeltaPill below is still used by the plain, untinted places.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import StatCard, { type StatMenuLink, type StatTone } from "./stat-card";

type Accent = "awaiting" | "approved" | "rejected" | "brand";
export type Delta = { dir: "up" | "down"; pct: number; note: string };

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

const ACCENT_TONE: Record<Accent, StatTone> = {
  brand: "brand",
  approved: "success",
  awaiting: "warn",
  rejected: "danger",
};

export default function Metric({
  label,
  value,
  sub,
  icon,
  accent = "brand",
  tone,
  trend,
  menu,
}: {
  label: string;
  /** Usually a formatted string; a ReactNode is accepted so callers can pass
   *  an animated number (see CountUp) without Metric knowing about it. */
  value: ReactNode;
  sub?: string;
  icon?: LucideIcon;
  /** Meaning of the metric; picks the tile colour unless `tone` overrides it. */
  accent?: Accent;
  /** Explicit tile colour — used to vary a row of tiles. State colours
   *  (success / warn / danger) should only be used when they mean that. */
  tone?: StatTone;
  /** Real period-over-period change. Omit rather than fabricate one when
   *  there's nothing honest to compare against. */
  trend?: Delta;
  /** Real destinations only (reports, analytics…). */
  menu?: StatMenuLink[];
}) {
  return (
    <StatCard
      label={label}
      value={value}
      sub={sub}
      icon={icon}
      tone={tone ?? ACCENT_TONE[accent]}
      delta={trend}
      menu={menu}
    />
  );
}
