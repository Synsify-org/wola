"use client";
import Link from "next/link";
import { useState } from "react";
import { decideAction } from "@/app/(app)/applications/[id]/actions";
import { CheckCircle2, Clock, Users, Wallet } from "lucide-react";
import CountUp from "./count-up";
import Metric from "./metric";
import DashboardCard from "./dashboard-card";
import { formatMoney } from "@wola/engine";

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
      <form
        action={decideAction}
        className="flex flex-1 items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-200"
      >
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
          className="h-9 rounded-full bg-approved px-4 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.97]"
        >
          Approve
        </button>
      </form>
      <button
        onClick={() => setRejecting(true)}
        className="h-9 rounded-full border border-rejected px-4 text-sm font-semibold text-rejected transition-all hover:bg-rejected-wash active:scale-[0.97]"
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
  currency,
}: {
  queue: QueueItem[];
  teamActiveLoans: number;
  myOutstanding: number | null;
  currency: string;
}) {
  const ugx = (n: number) => formatMoney(n, currency);
  return (
    <div className="grid gap-4 lg:grid-cols-3 xl:gap-5">
      {/* HERO (2/3): the team queue, decided inline. */}
      <DashboardCard
        title={"Needs your decision" + (queue.length > 0 ? ` (${queue.length})` : "")}
        className="animate-in fade-in slide-in-from-bottom-2 duration-500 lg:col-span-2"
      >
        {queue.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="h-8 w-8 text-success-500" strokeWidth={1.5} aria-hidden />
            <p className="text-sm text-ink-soft">Nothing awaiting you. Your team&apos;s queue is clear.</p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {queue.map((item) => (
              <li
                key={item.applicationId}
                className="flex flex-col gap-3 rounded-xl border border-rule bg-paper/60 p-3.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/applications/${item.applicationId}`}
                      className="text-sm font-semibold text-ink hover:text-brand"
                    >
                      {item.employeeName}
                    </Link>
                    <span className="chip chip--awaiting">{item.productName}</span>
                  </div>
                  <p className="mt-0.5 text-[0.8125rem] text-ink-soft">
                    <span className="num">{ugx(item.amount)}</span> · {item.tenorMonths} mo · {roleLabel(item.stageRole)} stage
                  </p>
                </div>
                <DecideRow applicationId={item.applicationId} />
              </li>
            ))}
          </ul>
        )}
      </DashboardCard>

      {/* 1/3 column: queue depth, team context, my own position (demoted). */}
      <div className="grid content-start gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150 sm:grid-cols-3 lg:grid-cols-1 xl:gap-5">
        <Metric
          label="Awaiting you"
          value={<CountUp value={queue.length} />}
          sub={queue.length > 0 ? "Decide from the list" : "Queue is clear"}
          icon={Clock}
          accent={queue.length > 0 ? "awaiting" : "approved"}
        />
        <Metric label="Team active loans" value={<CountUp value={teamActiveLoans} />} sub="People reporting to you" icon={Users} />
        <Metric
          label="My outstanding"
          value={myOutstanding !== null ? <CountUp value={myOutstanding} format="money" currency={currency} /> : "No active loan"}
          sub="Your own loans"
          icon={Wallet}
        />
      </div>
    </div>
  );
}
