import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { DeltaPill } from "./metric";

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
    <svg viewBox={"0 0 " + w + " " + h} className="h-12 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-brand-400)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--color-brand-400)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#spark)" />
      <polyline
        points={line}
        fill="none"
        stroke="var(--color-brand)"
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
  icon: Icon,
  trend,
  delta,
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
}) {
  const context = [delta?.note, sub].filter(Boolean).join(" · ");

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-rule bg-surface p-5 shadow-theme-xs sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <span className="text-base font-medium text-ink">{label}</span>
        {Icon ? <Icon className="h-5 w-5 shrink-0 text-brand" strokeWidth={2} aria-hidden /> : null}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className="num text-[1.75rem] font-semibold leading-none tracking-tight text-ink sm:text-[2.125rem]"
          title={typeof value === "string" ? value : undefined}
        >
          {value}
        </span>
        {delta ? <DeltaPill delta={delta} /> : null}
      </div>
      {context ? <p className="mt-2 text-[0.8125rem] text-ink-soft">{context}</p> : null}
      {trend && trend.length >= 2 ? (
        <div className="mt-auto pt-5">
          <Sparkline data={trend} />
        </div>
      ) : null}
    </div>
  );
}
