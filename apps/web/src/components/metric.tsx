// apps/web/src/components/metric.tsx
// A single dashboard metric: dominant number, quiet label, optional context.
export default function Metric({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "awaiting" | "approved" | "rejected";
}) {
  const tone =
    accent === "awaiting" ? "text-awaiting"
    : accent === "approved" ? "text-approved"
    : accent === "rejected" ? "text-rejected"
    : "text-ink";
  return (
    <div className="rounded-lg border border-rule bg-surface p-4">
      <div className="caps">{label}</div>
      <div className={"num mt-2 text-2xl font-bold " + tone}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-ink-soft">{sub}</div> : null}
    </div>
  );
}
