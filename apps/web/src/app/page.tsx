// apps/web/src/app/page.tsx — the dashboard.
// Role-aware: an employee sees their own position; an approver sees the book
// and their queue. Same route, different truth — enforced by ctx.canSeeAllLoans,
// the same flag that governs the loan register.
import { headers } from "next/headers";
import { requireSession } from "@/lib/guard";
import { resolveTenant, employeeMetrics, approverMetrics, loansByProduct, inboxFor } from "@wola/db";
import { db } from "@/lib/tenant";
import Shell from "@/components/shell";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();
const shortDate = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function Metric({
  label, value, sub, accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "awaiting" | "approved";
}) {
  const tone =
    accent === "awaiting" ? "text-awaiting"
    : accent === "approved" ? "text-approved"
    : "text-ink";
  return (
    <div className="card rounded-xl">
      <div className="caps">{label}</div>
      <div className={`num text-2xl font-bold mt-2 ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-ink-soft mt-1">{sub}</div>}
    </div>
  );
}

export default async function Dashboard() {
  const slug = (await headers()).get("x-tenant-slug") ?? "";
  const tenant = slug ? await resolveTenant(db, slug) : null;

  const data = await requireSession(async (tx, ctx) => {
    const [me] = await tx`
      SELECT e.id, e.full_name, u.email
      FROM users u
      LEFT JOIN employees e ON e.user_id = u.id
      WHERE u.id = ${ctx.userId}`;

    const user = {
      name: (me?.full_name as string) ?? (me?.email as string) ?? "—",
      email: (me?.email as string) ?? "",
      role: ctx.role,
      canSeeAllLoans: ctx.canSeeAllLoans,
    };

    // Mine, always — even a CFO has their own loans.
    const mine = await employeeMetrics(tx, ctx.userId);

    if (!ctx.canSeeAllLoans) {
      return { user, mine, book: null, mix: [] };
    }

    // "Awaiting me" must be routed through the approval engine — the dept_head
    // rule cannot be expressed in SQL without duplicating engine logic, and
    // duplicated rules drift apart. Correctness over cleverness.
    const inbox = await inboxFor(tx, ctx.tenantId, {
      userId: ctx.userId,
      employeeId: (me?.id as string) ?? null,
      role: ctx.role,
    });

    const book = await approverMetrics(tx, inbox.length);
    const mix = await loansByProduct(tx);
    return { user, mine, book, mix };
  });

  const { user, mine, book, mix } = data;

  return (
    <Shell user={user} tenantName={(tenant?.name as string) ?? "Wola"}>
      <h1 className="text-2xl">Dashboard</h1>
      <p className="text-ink-soft mt-1 mb-8">
        {book ? "The staff loan book at a glance." : "Your loans and applications."}
      </p>

      {/* ── The book. Approvers only. ─────────────────────────── */}
      {book && (
        <section className="mb-10">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Metric
              label="Awaiting you"
              value={String(book.awaitingMe)}
              sub={book.awaitingMe > 0 ? "Needs your decision" : "Nothing pending"}
              accent={book.awaitingMe > 0 ? "awaiting" : undefined}
            />
            <Metric
              label="Total exposure"
              value={ugx(book.totalExposure)}
              sub="Scheduled outstanding"
            />
            <Metric
              label="Active loans"
              value={String(book.activeLoans)}
              sub={ugx(book.principalDisbursed) + " disbursed"}
            />
            <Metric
              label="Interest book"
              value={ugx(book.interestBook)}
              sub="If every loan runs to term"
            />
          </div>

          {book.awaitingMe > 0 && (
            <a href="/approvals" className="btn btn--primary rounded-full mt-5">
              Review {book.awaitingMe} application{book.awaitingMe === 1 ? "" : "s"}
            </a>
          )}
        </section>
      )}

      {/* ── Product mix ───────────────────────────────────────── */}
      {book && mix.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg mb-3">By product</h2>
          <table className="ledger">
            <thead>
              <tr>
                <th>Product</th>
                <th className="r">Loans</th>
                <th className="r">Principal</th>
              </tr>
            </thead>
            <tbody>
              {mix.map((m) => (
                <tr key={m.name as string}>
                  <td className="font-medium">{m.name as string}</td>
                  <td className="r num">{String(m.n)}</td>
                  <td className="r num">{ugx(Number(m.principal))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ── Your own position. Everyone, including the CFO. ───── */}
      <section>
        <h2 className="text-lg mb-3">{book ? "Your own loans" : "Your position"}</h2>

        {mine.activeLoans === 0 && mine.applicationsInFlight === 0 ? (
          <div className="card rounded-xl">
            <p className="text-ink-soft">You have no loans or applications.</p>
            <a href="/apply" className="btn btn--primary rounded-full mt-4">
              Apply for a loan
            </a>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Metric label="Active loans" value={String(mine.activeLoans)} />
              <Metric
                label="Outstanding"
                value={ugx(mine.outstanding)}
                sub="Scheduled"
              />
              <Metric
                label="Monthly deduction"
                value={ugx(mine.monthlyDeduction)}
                sub="From payroll"
              />
              <Metric
                label="Next due"
                value={mine.nextDueDate ? shortDate(mine.nextDueDate) : "—"}
              />
            </div>

            {mine.applicationsInFlight > 0 && (
              <p className="text-sm text-awaiting mt-4">
                {mine.applicationsInFlight} application
                {mine.applicationsInFlight === 1 ? "" : "s"} in review.
              </p>
            )}

            <div className="flex gap-3 mt-5">
              <a href="/loans" className="btn btn--ghost rounded-full">View my loans</a>
              <a href="/apply" className="btn btn--primary rounded-full">Apply again</a>
            </div>
          </>
        )}
      </section>
    </Shell>
  );
}
