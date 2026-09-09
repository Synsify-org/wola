"use client";
import Link from "next/link";
import { Banknote, AlertTriangle, ArrowRight } from "lucide-react";
import { Progress } from "./ui/progress";
import DisburseButton from "./disburse-button";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();

export interface DisbursementQueueItem {
  loanId: string;
  borrower: string;
  product: string;
  amount: number;
  approvedAt: string;
}
export interface ReconciliationException {
  loanId: string;
  borrower: string;
  product: string;
  expected: number;
  actual: number;
  shortfall: number;
}
export interface ReconciliationCycle {
  cycleLabel: string;
  expected: number;
  actual: number;
  exceptions: ReconciliationException[];
}

const daysWaiting = (iso: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

// The CFO's money-operations console — the hero the architecture doc calls
// the biggest real gap. Two parts, both previously only reachable one loan
// at a time from its own detail page: a disbursement queue (money going
// out) and payroll reconciliation (money that should have come back).
export default function CFOMoneyOps({
  queue,
  reconciliation,
}: {
  queue: DisbursementQueueItem[];
  reconciliation: ReconciliationCycle | null;
}) {
  const collected = reconciliation && reconciliation.expected > 0
    ? Math.round((reconciliation.actual / reconciliation.expected) * 100)
    : 100;

  return (
    <div className="overflow-hidden rounded-xl border border-rule bg-surface shadow-theme-md">
      {/* Disbursement queue */}
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-brand-700">
              <Banknote className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-semibold text-ink">
              Disbursement queue{queue.length > 0 ? ` (${queue.length} awaiting)` : ""}
            </h2>
          </div>
        </div>

        {queue.length === 0 ? (
          <p className="py-3 text-sm text-ink-soft">Nothing awaiting disbursement.</p>
        ) : (
          <div className="space-y-2">
            {queue.map((item) => (
              <div
                key={item.loanId}
                className="flex flex-col gap-3 rounded-lg border border-rule bg-paper p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">{item.borrower}</span>
                    <span className="chip chip--awaiting">{item.product}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {ugx(item.amount)} · approved {daysWaiting(item.approvedAt)}d ago
                  </p>
                </div>
                <DisburseButton loanId={item.loanId} amount={item.amount} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-rule" />

      {/* Reconciliation */}
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">
            Reconciliation — {reconciliation?.cycleLabel ?? "this cycle"}
          </h2>
          {reconciliation && reconciliation.exceptions.length > 0 ? (
            <span className="chip chip--rejected">
              {reconciliation.exceptions.length} exception{reconciliation.exceptions.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>

        {!reconciliation || reconciliation.expected === 0 ? (
          <p className="py-3 text-sm text-ink-soft">Nothing due from payroll this cycle.</p>
        ) : (
          <>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-ink-soft">
                Expected <span className="num font-medium text-ink">{ugx(reconciliation.expected)}</span>
              </span>
              <span className="text-ink-soft">
                Actual <span className="num font-medium text-ink">{ugx(reconciliation.actual)}</span>
              </span>
            </div>
            <Progress
              value={collected}
              className="mt-2"
              indicatorClassName={collected >= 100 ? "bg-approved" : "bg-awaiting"}
            />

            {reconciliation.exceptions.length > 0 ? (
              <div className="mt-4 space-y-2">
                {reconciliation.exceptions.map((e) => (
                  <div
                    key={e.loanId}
                    className="flex items-center justify-between gap-3 rounded-lg bg-rejected-wash px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2 text-sm">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rejected" />
                      <span className="truncate font-medium text-ink">{e.borrower}</span>
                      <span className="shrink-0 text-ink-soft">short {ugx(e.shortfall)}</span>
                    </div>
                    <Link
                      href={`/loans/${e.loanId}`}
                      className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand hover:underline"
                    >
                      Resolve <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
