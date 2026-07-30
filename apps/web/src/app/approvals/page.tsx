// apps/web/src/app/approvals/page.tsx - the approver inbox.
// Applications awaiting THIS actor, resolved through the approval engine.
import { headers } from "next/headers";
import { requireSession } from "@/lib/guard";
import { inboxFor, resolveTenant } from "@wola/db";
import { db } from "@/lib/tenant";
import Shell from "@/components/shell";
import Link from "next/link";
import { Inbox } from "lucide-react";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();
const label = (r: string) =>
  r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default async function ApprovalInbox() {
  const slug = (await headers()).get("x-tenant-slug") ?? "";
  const tenant = slug ? await resolveTenant(db, slug) : null;

  const data = await requireSession(async (tx, ctx) => {
    const [me] = await tx`
      SELECT e.id, e.full_name, u.email
      FROM users u
      LEFT JOIN employees e ON e.user_id = u.id
      WHERE u.id = ${ctx.userId}`;
    const inbox = await inboxFor(tx, ctx.tenantId, {
      userId: ctx.userId,
      employeeId: (me?.id as string) ?? null,
      role: ctx.role,
    });
    return {
      user: {
        name: (me?.full_name as string) ?? (me?.email as string) ?? "-",
        email: (me?.email as string) ?? "",
        role: ctx.role,
        canSeeAllLoans: ctx.canSeeAllLoans,
        canApprove: ctx.canApprove,
      },
      items: inbox,
    };
  });

  const { user, items } = data;

  return (
    <Shell user={user} tenantName={(tenant?.name as string) ?? "Wola"}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink">Approvals</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {items.length === 0
            ? "Nothing needs your decision right now."
            : items.length + " application" + (items.length === 1 ? "" : "s") + " awaiting your decision."}
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-rule bg-surface p-12 text-center shadow-theme-sm">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600">
            <Inbox className="h-6 w-6" />
          </span>
          <p className="text-sm font-medium text-ink">Your queue is clear</p>
          <p className="mt-1 text-sm text-ink-soft">
            When an application reaches your stage, it appears here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-rule bg-surface shadow-theme-sm">
          <table className="ledger">
            <thead>
              <tr>
                <th>Applicant</th>
                <th>Product</th>
                <th className="r">Amount</th>
                <th className="r">Tenor</th>
                <th>Your stage</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.applicationId}>
                  <td className="font-medium text-ink">{a.employeeName}</td>
                  <td className="text-ink-soft">{a.productName}</td>
                  <td className="r num font-semibold text-brand-700">{ugx(a.amount)}</td>
                  <td className="r num text-ink-soft">{a.tenorMonths} mo</td>
                  <td>
                    <span className="chip chip--awaiting">{label(a.stageRole)}</span>
                  </td>
                  <td className="r">
                    <Link
                      href={"/applications/" + a.applicationId}
                      className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-ink transition-colors hover:bg-brand-deep"
                    >
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
