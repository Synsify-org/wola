"use client";
import Link from "next/link";

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
  return (
    <div className="rounded-xl border border-rule bg-surface p-5 shadow-theme-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="caps">Recent activity</div>
        <Link href="/loans" className="text-xs font-medium text-brand hover:underline">
          View all
        </Link>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-ink-soft">No active loans yet.</p>
      ) : (
        <ul className="divide-y divide-rule">
          {data.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">{r.borrower}</div>
                <div className="truncate text-xs text-ink-soft">{r.product}</div>
              </div>
              <div className="ml-4 shrink-0 text-right">
                <div className="num text-sm text-ink">{ugx(r.principal)}</div>
                <div className="num text-xs text-ink-faint">{shortDate(r.date)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
