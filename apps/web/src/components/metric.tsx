// apps/web/src/components/metric.tsx
// A dashboard KPI: icon chip, dominant number, quiet label, optional trend.
// Subtle hover lift for tactility.
import type { LucideIcon } from "lucide-react";

export default function Metric({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: LucideIcon;
  accent?: "awaiting" | "approved" | "rejected" | "brand";
  trend?: { dir: "up" | "down"; text: string };
}) {
  const chip =
    accent === "awaiting" ? "bg-warning-100 text-warning-700"
    : accent === "approved" ? "bg-success-100 text-success-700"
    : accent === "rejected" ? "bg-error-100 text-error-700"
    : "bg-brand-100 text-brand-700";

  return (
    <div className="group rounded-xl border border-rule bg-surface p-5 shadow-theme-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-theme-md">
      <div className="flex items-start justify-between">
        <span className="caps">{label}</span>
        {Icon ? (
          <span className={"grid h-11 w-11 place-items-center rounded-xl transition-transform duration-200 group-hover:scale-105 " + chip}>
            <Icon className="h-5 w-5" strokeWidth={2} />
          </span>
        ) : null}
      </div>
      <div className="num mt-3 text-[1.75rem] font-bold leading-tight text-ink">
        {value}
      </div>
      <div className="mt-1 flex items-center gap-2">
        {trend ? (
          <span
            className={
              "num text-xs font-semibold " +
              (trend.dir === "up" ? "text-approved" : "text-rejected")
            }
          >
            {trend.dir === "up" ? "\u2191" : "\u2193"} {trend.text}
          </span>
        ) : null}
        {sub ? <span className="text-xs text-ink-soft">{sub}</span> : null}
      </div>
    </div>
  );
}
