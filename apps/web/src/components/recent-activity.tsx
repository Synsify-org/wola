"use client";
import Link from "next/link";
import DashboardCard from "./dashboard-card";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();
const shortDate = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "-";

type Item = {
  id: string;
  borrower: string;
  product: string;
  principal: number;
  date: string | null;
};

export default function RecentActivity({ data }: { data: Item[] }) {
  const action = (
    <Link href="/loans" className="text-xs font-medium text-brand hover:underline">
      View all
    </Link>
  );

  return (
    <DashboardCard title="Recent activity" action={action}>
      {data.length === 0 ? (
        <p className="text-sm text-ink-soft">No active loans yet.</p>
      ) : (
        <ul>
          {data.map((r, i) => (
            <li key={r.id} className="flex gap-3">
              {/* Timeline rail: dot + connector, stretched to row height */}
              <div className="flex flex-col items-center">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand ring-4 ring-brand-wash" />
                {i < data.length - 1 ? (
                  <span className="w-px flex-1 bg-rule" />
                ) : null}
              </div>
              <div className="flex min-w-0 flex-1 items-center justify-between pb-5 last:pb-0">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink" title={r.borrower}>{r.borrower}</div>
                  <div className="truncate text-xs text-ink-soft" title={r.product}>{r.product}</div>
                </div>
                <div className="ml-4 shrink-0 text-right">
                  <div className="num text-sm text-ink">{ugx(r.principal)}</div>
                  <div className="num text-xs text-ink-faint">{shortDate(r.date)}</div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}
