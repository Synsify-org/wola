// apps/web/src/components/decision-queue.tsx
// "Needs your decision" — the approval worklist preview shared by the CFO,
// CEO, COO and HR dashboards (previously four hand-copied tables). A real
// table from sm: up; stacked rows on phones, so it never scrolls sideways.
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { formatMoney } from "@wola/engine";
import DashboardCard from "./dashboard-card";
import { Avatar } from "@/components/ui/avatar";
import { waitingFor } from "@/lib/waiting";
import { humanize } from "@/lib/product-summary";

export type DecisionItem = {
  applicationId: string;
  employeeName: string;
  productName: string;
  amount: number;
  tenorMonths?: number;
  stageRole?: string;
  /** When it reached this approver, and the stage time limit (hours). */
  waitingSince?: string;
  slaHours?: number | null;
};

/** "3 days" or, past the stage's time limit, an "Over limit" chip. */
function Waiting({ item }: { item: DecisionItem }) {
  if (!item.waitingSince) return null;
  const w = waitingFor(item.waitingSince, item.slaHours);
  return w.overdue
    ? <span className="chip chip--rejected" title={`Time limit for this stage: ${item.slaHours} hours`}>{w.text} · over limit</span>
    : <span className="text-xs text-ink-soft">{w.text}</span>;
}

const roleLabel = humanize;

export default function DecisionQueue({
  title,
  items,
  currency,
  emptyText = "Nothing is waiting on you. The queue is clear.",
  showTenor = false,
  showStage = false,
  className = "",
}: {
  title: string;
  items: DecisionItem[];
  currency: string;
  emptyText?: string;
  showTenor?: boolean;
  showStage?: boolean;
  className?: string;
}) {
  const money = (n: number) => formatMoney(n, currency);
  const review = (id: string) => "/approvals?app=" + id;

  return (
    <DashboardCard
      title={title}
      flush
      className={className}
      action={
        items.length > 0 ? (
          <Link href="/approvals" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : null
      }
    >
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 pb-8 pt-4 text-center">
          <CheckCircle2 className="h-8 w-8 text-success-500" strokeWidth={1.5} aria-hidden />
          <p className="text-sm text-ink-soft">{emptyText}</p>
        </div>
      ) : (
        <>
          <div className="hidden sm:block">
            <table className="ledger">
              <thead>
                <tr>
                  <th className="pl-6!">Applicant</th>
                  <th>Product</th>
                  <th className="r">Amount</th>
                  <th>Waiting</th>
                  {showTenor ? <th className="r">Tenor</th> : null}
                  {showStage ? <th>Stage</th> : null}
                  <th className="pr-6!"><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.applicationId}>
                    <td className="pl-6! font-medium text-ink">
                      <span className="flex items-center gap-3">
                        <Avatar name={item.employeeName} size="sm" />
                        {item.employeeName}
                      </span>
                    </td>
                    <td className="text-ink-soft">{item.productName}</td>
                    <td className="r num">{money(item.amount)}</td>
                    <td className="whitespace-nowrap"><Waiting item={item} /></td>
                    {showTenor ? <td className="r num">{item.tenorMonths} mo</td> : null}
                    {showStage ? (
                      <td>{item.stageRole ? <span className="chip chip--awaiting">{roleLabel(item.stageRole)}</span> : null}</td>
                    ) : null}
                    <td className="r pr-6!">
                      <Link href={review(item.applicationId)} className="text-sm font-medium text-brand hover:underline">
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-rule border-t border-rule sm:hidden">
            {items.map((item) => (
              <li key={item.applicationId}>
                <Link
                  href={review(item.applicationId)}
                  className="flex min-h-14 items-center justify-between gap-3 px-5 py-3.5 transition-colors active:bg-paper"
                >
                  <Avatar name={item.employeeName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{item.employeeName}</div>
                    <div className="text-xs text-ink-soft">
                      {item.productName}
                      {showTenor && item.tenorMonths ? ` · ${item.tenorMonths} mo` : ""}
                    </div>
                    {item.waitingSince ? <div className="mt-0.5"><Waiting item={item} /></div> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="num text-sm font-medium text-ink">{money(item.amount)}</span>
                    <ArrowRight className="h-4 w-4 text-ink-faint" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </DashboardCard>
  );
}
