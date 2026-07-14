// apps/web/src/app/approvals/page.tsx — the approver inbox.
// Shows only applications awaiting THIS actor, resolved through the approval
// engine so "dept_head" correctly means "this applicant's department head",
// not "anyone with the dept_head role".
import { headers } from "next/headers";
import { requireSession } from "@/lib/guard";
import { inboxFor, resolveTenant } from "@wola/db";
import { db } from "@/lib/tenant";
import Shell from "@/components/shell";

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

    const items = await inboxFor(tx, {
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
      },
      items,
    };
  });

  const { user, items } = data;

  return (
    <Shell user={user} tenantName={(tenant?.name as string) ?? "Wola"}>
      <h1 className="text-2xl">Approvals</h1>
      <p className="text-ink-soft mt-1 mb-8">
        {items.length === 0
          ? "Nothing needs your decision."
          : items.length + " application" + (items.length === 1 ? "" : "s") + " awaiting you."}
      </p>

      {items.length === 0 ? (
        <div className="card rounded-xl">
          <p className="text-ink-soft">
            When an application reaches your stage, it appears here.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {items.map((a) => (
            <a
              key={a.applicationId}
              href={"/applications/" + a.applicationId}
              className="card rounded-xl hover:border-brand transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-semibold">{a.employeeName}</div>
                  <div className="text-sm text-ink-soft">{a.productName}</div>
                </div>
                <div className="text-right">
                  <div className="num font-bold">{ugx(a.amount)}</div>
                  <div className="text-sm text-ink-soft">{a.tenorMonths} months</div>
                </div>
              </div>
              <div className="mt-4">
                <span className="chip chip--awaiting">
                  {label(a.stageRole)} - your decision
                </span>
              </div>
            </a>
          ))}
        </div>
      )}
    </Shell>
  );
}
