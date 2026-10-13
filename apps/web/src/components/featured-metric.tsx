import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import StatCard, { type StatMenuLink, type StatTone } from "./stat-card";

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const w = 240;
  const h = 48;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / range) * h;
    return x + "," + y;
  });
  const line = pts.join(" ");
  const area = "0," + h + " " + line + " " + w + "," + h;
  return (
    <svg viewBox={"0 0 " + w + " " + h} className="h-12 w-full text-current" preserveAspectRatio="none" aria-hidden focusable="false">
      <polygon points={area} fill="currentColor" fillOpacity="0.14" />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.9"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function FeaturedMetric({
  label,
  value,
  sub,
  icon,
  trend,
  delta,
  tone = "deep",
  menu,
}: {
  label: string;
  /** Usually a formatted string; a ReactNode is accepted so callers can pass
   *  an animated number (see CountUp) without this component knowing about it. */
  value: ReactNode;
  sub?: string;
  icon?: LucideIcon;
  trend?: number[];
  /** Real period-over-period change, e.g. computed from the same trend
   *  series. Omit rather than fabricate a number when there's nothing to
   *  compare against (e.g. the first month on the book). */
  delta?: { dir: "up" | "down"; pct: number; note: string };
  tone?: StatTone;
  menu?: StatMenuLink[];
}) {
  return (
    <StatCard
      featured
      label={label}
      value={value}
      sub={sub}
      icon={icon}
      tone={tone}
      delta={delta}
      menu={menu}
      chart={trend && trend.length >= 2 ? <Sparkline data={trend} /> : undefined}
    />
  );
}
