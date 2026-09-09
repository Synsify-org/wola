"use client";
import DashboardCard from "./dashboard-card";

type PipelineRow = { status: string; n: number };

// Ordered stages with their state-colour treatment.
const ORDER = [
  { key: "submitted", label: "Submitted", cls: "bg-awaiting" },
  { key: "in_review", label: "In review", cls: "bg-awaiting" },
  { key: "approved", label: "Approved", cls: "bg-approved" },
  { key: "rejected", label: "Rejected", cls: "bg-rejected" },
];

export default function PipelinePanel({ data }: { data: PipelineRow[] }) {
  const counts: Record<string, number> = {};
  for (const r of data) counts[r.status] = r.n;
  const total = data.reduce((s, r) => s + r.n, 0);

  return (
    <DashboardCard title="Application pipeline">
      {total === 0 ? (
        <p className="text-sm text-ink-soft">No applications yet.</p>
      ) : (
        <div className="space-y-3">
          {ORDER.map((s) => {
            const n = counts[s.key] ?? 0;
            const pct = total > 0 ? (n / total) * 100 : 0;
            return (
              <div key={s.key}>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="text-ink">{s.label}</span>
                  <span className="num font-medium text-ink">{n}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={"h-full rounded-full " + s.cls}
                    style={{ width: Math.max(pct, n > 0 ? 3 : 0) + "%" }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DashboardCard>
  );
}
