import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { formatMoney } from "@wola/engine";
import DashboardCard from "./dashboard-card";
import { Avatar } from "@/components/ui/avatar";
import type { RejectionRow } from "@/lib/rejections";

const label = (r: string) => r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const shortDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

const INTRO: Record<"own" | "department" | "all", string> = {
  own: "Your applications that were turned down, and the reason given.",
  department: "Applications from your department that were turned down, and the reason given.",
  all: "Every application turned down across the book, and the reason given.",
};

export default function RejectionsPanel({
  rows,
  total,
  currency,
  scope,
}: {
  rows: RejectionRow[];
  total: number;
  currency: string;
  scope: "own" | "department" | "all";
}) {
  // Someone looking at only their own rejections doesn't need their own name
  // repeated on every row.
  const showApplicant = scope !== "own";

  return (
    <DashboardCard title={`Rejections${total > 0 ? ` (${total})` : ""}`} className="animate-in fade-in slide-in-from-bottom-2 duration-500">
      <p className="-mt-1 mb-4 text-sm text-ink-soft">{INTRO[scope]}</p>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-approved-wash text-approved">
            <CheckCircle2 className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-sm font-medium text-ink">No rejections</p>
          <p className="max-w-sm text-sm text-ink-soft">
            {scope === "own"
              ? "None of your applications has been turned down."
              : "No application in your view has been turned down."}
          </p>
        </div>
      ) : (
        <>
          {/* Phones: the reason is the point of this view, so each rejection is
              a small card with the reason in full, not a truncated table cell. */}
          <ul className="-mx-1 divide-y divide-rule sm:hidden">
            {rows.map((r) => (
              <li key={r.applicationId} className="px-1 py-4">
                <div className="flex items-start gap-3">
                  <Avatar name={showApplicant ? r.applicant : r.rejectedBy} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-medium text-ink">
                        {showApplicant ? r.applicant : r.product}
                      </span>
                      <span className="num shrink-0 text-sm font-medium text-ink">
                        {formatMoney(r.amount, currency)}
                      </span>
                    </div>
                    <div className="text-xs text-ink-soft">
                      {showApplicant ? `${r.product} · ` : ""}
                      {r.tenorMonths} mo
                    </div>
                  </div>
                </div>
                <blockquote className="mt-3 rounded-lg bg-rejected-wash px-3 py-2 text-sm text-ink">
                  {r.reason ?? <span className="italic text-ink-faint">No reason recorded</span>}
                </blockquote>
                <div className="mt-2 flex items-center justify-between gap-3 text-xs text-ink-soft">
                  <span className="min-w-0 truncate">
                    {r.rejectedBy ?? "—"}
                    {r.rejectedByTitle || r.stageRole ? ` · ${r.rejectedByTitle || label(r.stageRole ?? "")}` : ""}
                    {" · "}
                    {shortDate(r.rejectedAt)}
                  </span>
                  <Link href={"/applications/" + r.applicationId} className="shrink-0 font-medium text-brand hover:underline">
                    View
                  </Link>
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto sm:block">
            <table className="ledger">
              <thead>
                <tr>
                  {showApplicant ? <th>Applicant</th> : null}
                  <th>Loan</th>
                  <th className="r">Amount</th>
                  <th>Reason given</th>
                  <th>Rejected by</th>
                  <th>Date</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.applicationId}>
                    {showApplicant ? (
                      <td>
                        <div className="flex items-center gap-3">
                          <Avatar name={r.applicant} size="sm" />
                          <div>
                            <div className="font-medium text-ink">{r.applicant}</div>
                            <div className="num text-xs text-ink-faint">{r.employeeNo}</div>
                          </div>
                        </div>
                      </td>
                    ) : null}
                    <td className="text-ink-soft">{r.product}</td>
                    <td className="r num">
                      {formatMoney(r.amount, currency)}
                      <div className="text-xs text-ink-faint">{r.tenorMonths} mo</div>
                    </td>
                    <td className="max-w-[26rem] whitespace-normal">
                      {r.reason ? (
                        <span className="text-sm text-ink">{r.reason}</span>
                      ) : (
                        <span className="text-sm italic text-ink-faint">No reason recorded</span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={r.rejectedBy} size="xs" />
                        <div>
                          <div className="text-sm text-ink">{r.rejectedBy ?? "—"}</div>
                          <div className="text-xs text-ink-soft">
                            {r.rejectedByTitle || (r.stageRole ? label(r.stageRole) : "")}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="num whitespace-nowrap text-ink-soft">{shortDate(r.rejectedAt)}</td>
                    <td className="r">
                      <Link href={"/applications/" + r.applicationId} className="text-xs font-medium text-brand hover:underline">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > rows.length ? (
            <p className="mt-3 text-xs text-ink-faint">
              Showing the {rows.length} most recent of {total}.
            </p>
          ) : null}
        </>
      )}
    </DashboardCard>
  );
}
