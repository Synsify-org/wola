// apps/web/src/app/approvals/page.tsx - the approver inbox.
// Applications awaiting THIS actor, resolved through the approval engine.
import { requireSession } from "@/lib/guard";
import { inboxFor } from "@wola/db";
import Link from "next/link";
import { ArrowRight, Inbox } from "lucide-react";
import { formatMoney } from "@wola/engine";
import { getTenantCurrency } from "@/lib/tenant";

const label = (r: string) =>
  r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default async function ApprovalInbox() {
  const currency = await getTenantCurrency();
  const ugx = (n: number) => formatMoney(n, currency);
  const items = await requireSession(async (tx, ctx) => {
    const [me] = await tx`SELECT id FROM employees WHERE user_id = ${ctx.userId}`;
    return inboxFor(tx, ctx.tenantId, {
      userId: ctx.userId,
      employeeId: (me?.id as string) ?? null,
      role: ctx.role,
    });
  });

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Approvals</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {items.length === 0
            ? "Nothing needs your decision right now."
            : items.length + " application" + (items.length === 1 ? "" : "s") + " awaiting your decision."}
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-rule bg-surface p-12 text-center shadow-theme-xs">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600">
            <Inbox className="h-6 w-6" />
          </span>
          <p className="text-sm font-medium text-ink">Your queue is clear</p>
          <p className="mt-1 text-sm text-ink-soft">
            When an application reaches your stage, it appears here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-rule bg-surface shadow-theme-xs">
          {/* sm+: the full table. */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="ledger">
              <thead>
                <tr>
                  <th className="pl-6!">Applicant</th>
                  <th>Product</th>
                  <th className="r">Amount</th>
                  <th className="r">Tenor</th>
                  <th>Your stage</th>
                  <th className="pr-6!"><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.applicationId}>
                    <td className="pl-6! font-medium text-ink">{a.employeeName}</td>
                    <td className="text-ink-soft">{a.productName}</td>
                    <td className="r num font-semibold text-brand-700">{ugx(a.amount)}</td>
                    <td className="r num text-ink-soft">{a.tenorMonths} mo</td>
                    <td>
                      <span className="chip chip--awaiting">{label(a.stageRole)}</span>
                    </td>
                    <td className="r pr-6!">
                      <Link
                        href={"/applications/" + a.applicationId}
                        className="inline-flex items-center gap-1 rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-brand-ink transition-colors hover:bg-brand-deep"
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: one stacked row per application — the approver's daily
              worklist must read at a glance on a 375px screen, not scroll
              sideways through six squeezed columns. */}
          <ul className="divide-y divide-rule sm:hidden">
            {items.map((a) => (
              <li key={a.applicationId} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[0.9375rem] font-semibold text-ink">{a.employeeName}</div>
                    <div className="mt-0.5 text-[0.8125rem] text-ink-soft">
                      {a.productName} · <span className="num">{a.tenorMonths} mo</span>
                    </div>
                  </div>
                  <span className="chip chip--awaiting shrink-0">{label(a.stageRole)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="num whitespace-nowrap text-lg font-semibold text-brand-700">{ugx(a.amount)}</span>
                  <Link
                    href={"/applications/" + a.applicationId}
                    className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-brand px-5 text-sm font-semibold text-brand-ink transition-all hover:bg-brand-deep active:scale-[0.97]"
                  >
                    Review <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
