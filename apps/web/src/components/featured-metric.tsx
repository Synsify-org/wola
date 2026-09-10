import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();

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
  value: string;
  sub?: string;
  icon?: LucideIcon;
  trend?: number[];
  /** Real period-over-period change, e.g. computed from the same trend
   *  series. Omit rather than fabricate a number when there's nothing to
   *  compare against (e.g. the first month on the book). */
  delta?: { dir: "up" | "down"; pct: number; note: string };
}) {
  return (
    <div className="flex flex-col rounded-xl border border-rule bg-surface p-6 shadow-theme-md">
      <div className="flex items-start justify-between">
        <span className="caps">{label}</span>
        {Icon ? (
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-100 text-brand-700">
            <Icon className="h-5 w-5" strokeWidth={2} />
          </span>
        ) : null}
      </div>
      <div className="num mt-3 text-3xl font-bold leading-tight text-ink">{value}</div>
      {delta ? (
        <div className="mt-2 flex items-center gap-1.5">
          <span
            className={
              "grid h-5.5 w-5.5 shrink-0 place-items-center rounded-full " +
              (delta.dir === "up" ? "bg-success-100 text-success-700" : "bg-error-100 text-error-700")
            }
          >
            {delta.dir === "up" ? (
              <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.5} />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5" strokeWidth={2.5} />
            )}
          </span>
          <span className="num text-xs font-semibold text-ink">{Math.abs(delta.pct)}%</span>
          <span className="text-xs text-ink-soft">{delta.note}</span>
        </div>
      ) : sub ? (
        <div className="mt-1 text-sm text-ink-soft">{sub}</div>
      ) : null}
      {trend && trend.length >= 2 ? (
        <div className="mt-4">
          <Sparkline data={trend} />
        </div>
      ) : null}
    </div>
  );
}
