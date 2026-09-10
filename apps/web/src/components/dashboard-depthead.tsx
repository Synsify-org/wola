"use client";
import Link from "next/link";
import { useState } from "react";
import { decideAction } from "@/app/applications/[id]/actions";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();
const roleLabel = (r: string) =>
  r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const today = () => new Date().toISOString().slice(0, 10);

export type QueueItem = {
  applicationId: string;
  employeeName: string;
  productName: string;
  amount: number;
  tenorMonths: number;
  stageRole: string;
};

// Inline approve/reject for one queue row, via the SAME decideAction() the
// full application page uses (server-enforced: rejection needs a reason,
// startDate needed for a final approval). Reject expands a compact reason
// field in place rather than navigating away — the point of an inbox is not
// leaving it for a routine decision. decideAction redirects to /approvals on
// completion either way, same as the full application page.
function DecideRow({ applicationId }: { applicationId: string }) {
  const [rejecting, setRejecting] = useState(false);

  if (rejecting) {
    return (
      <form action={decideAction} className="flex flex-1 items-center gap-2">
        <input type="hidden" name="applicationId" value={applicationId} />
        <input type="hidden" name="decision" value="rejected" />
        <input
          name="comment"
          required
          placeholder="Reason for rejecting…"
          className="h-8 flex-1 rounded-md border border-rule bg-paper px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-brand"
          autoFocus
        />
        <button type="submit" className="btn btn--danger h-8 rounded-full px-3 text-xs">
          Confirm
        </button>
        <button
          type="button"
          onClick={() => setRejecting(false)}
          className="text-xs text-ink-soft hover:text-ink"
        >
          Cancel
        </button>
      </form>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <form action={decideAction}>
        <input type="hidden" name="applicationId" value={applicationId} />
        <input type="hidden" name="decision" value="approved" />
        <input type="hidden" name="startDate" value={today()} />
        <button
          type="submit"
          className="rounded-full bg-approved px-3 py-1 text-xs font-semibold text-white hover:opacity-90"
        >
          Approve
        </button>
      </form>
      <button
        onClick={() => setRejecting(true)}
        className="rounded-full border border-rejected px-3 py-1 text-xs font-semibold text-rejected hover:bg-rejected-wash"
      >
        Reject
      </button>
    </div>
  );
}

// The Dept-head hero: "who on my team needs my decision right now." A large,
// inbox-like worklist — the queue IS the hero here, unlike HR's dashboard
// where the same kind of queue is demoted to secondary.
export default function DashboardDeptHead({
  queue,
  teamActiveLoans,
  myOutstanding,
}: {
  queue: QueueItem[];
  teamActiveLoans: number;
  myOutstanding: number | null;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-rule bg-surface p-5 shadow-theme-md">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">
            Needs your decision{queue.length > 0 ? ` (${queue.length})` : ""}
          </h2>
        </div>
        {queue.length === 0 ? (
          <p className="py-3 text-sm text-ink-soft">Nothing awaiting you. Your team&apos;s queue is clear.</p>
        ) : (
          <div className="space-y-2">
            {queue.map((item) => (
              <div
                key={item.applicationId}
                className="flex flex-col gap-3 rounded-lg border border-rule bg-paper p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/applications/${item.applicationId}`}
                      className="text-sm font-semibold text-ink hover:text-brand"
                    >
                      {item.employeeName}
                    </Link>
                    <span className="chip chip--awaiting">{item.productName}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {ugx(item.amount)} · {item.tenorMonths} mo · {roleLabel(item.stageRole)} stage
                  </p>
                </div>
                <DecideRow applicationId={item.applicationId} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Secondary, quieter: my own position (shrunk) + team size context. */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0 overflow-hidden rounded-xl border border-rule bg-surface p-4 shadow-theme-sm">
          <div className="caps mb-1">My outstanding</div>
          <div className="num truncate text-xl font-semibold text-ink">
            {myOutstanding !== null ? ugx(myOutstanding) : "No active loan"}
          </div>
        </div>
        <div className="min-w-0 overflow-hidden rounded-xl border border-rule bg-surface p-4 shadow-theme-sm">
          <div className="caps mb-1">Team active loans</div>
          <div className="num truncate text-xl font-semibold text-ink">{teamActiveLoans}</div>
        </div>
      </section>

      <div className="flex gap-3">
        <Link href="/loans?mine=1" className="btn btn--ghost rounded-full">
          View my loans
        </Link>
        <Link href="/apply" className="btn btn--primary rounded-full">
          Apply for a loan
        </Link>
      </div>
    </div>
  );
}
