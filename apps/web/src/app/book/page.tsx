// apps/web/src/app/book/page.tsx — the OVERSIGHT view.
// Separate from /loans (which is always "My loans", the viewer's own). This is
// what a manager oversees: a dept head sees their department; a full-book role
// (cfo/hr/ceo/...) sees the whole tenant book. An employee has no oversight
// scope and is redirected to their own loans.
import { redirect } from "next/navigation";
import { requireSession, scopePredicate } from "@/lib/guard";
import { resolveTenant } from "@wola/db";
import { db } from "@/lib/tenant";
import { headers } from "next/headers";
import Shell from "@/components/shell";
import Link from "next/link";
import Metric from "@/components/metric";
import { Layers, CheckCircle, Banknote, Wallet } from "lucide-react";

type Row = {
  id: string;
  employee_name: string;
  employee_no: string;
  product_name: string;
  principal: string;
  annual_rate: string;
  tenor_months: number;
  status: string;
  start_date: string;
  outstanding: string | null;
};

const ugx = (n: number | string) => "UGX " + Math.round(Number(n)).toLocaleString();

export default async function BookPage() {
  const slug = (await headers()).get("x-tenant-slug") ?? "";
  const tenant = slug ? await resolveTenant(db, slug) : null;

  const result = await requireSession(async (tx, ctx) => {
    // Employees have no oversight scope — send them to their own loans.
    if (ctx.scope === "own") return { redirect: true as const };

    const [me] = await tx`SELECT e.full_name, u.email FROM users u LEFT JOIN employees e ON e.user_id = u.id WHERE u.id = ${ctx.userId}`;
    const rows = (await tx`
      SELECT l.id, l.principal, l.annual_rate, l.tenor_months, l.status, l.start_date,
             e.full_name AS employee_name, e.employee_no,
             lp.name AS product_name,
             COALESCE(
               (SELECT sl.closing_balance
                  FROM schedule_lines sl
                  JOIN loan_schedules s ON s.id = sl.schedule_id
                 WHERE s.loan_id = l.id AND s.is_active
                   AND sl.due_date <= CURRENT_DATE
                 ORDER BY sl.period_no DESC LIMIT 1),
               l.principal
             ) AS outstanding
      FROM loans l
      JOIN loan_applications la ON la.id = l.application_id
      JOIN employees e ON e.id = la.employee_id
      JOIN loan_products lp ON lp.id = la.loan_product_id
      WHERE ${scopePredicate(tx, ctx)}
      ORDER BY l.created_at DESC`) as unknown as Row[];

    return {
      redirect: false as const,
      loans: rows,
      scope: ctx.scope,
      user: {
        name: (me?.full_name as string) ?? (me?.email as string) ?? "-",
        email: (me?.email as string) ?? "",
        role: ctx.role,
        canSeeAllLoans: ctx.canSeeAllLoans,
        canApprove: ctx.canApprove,
      },
    };
  });

  if (result.redirect) redirect("/loans");
  const { loans, scope, user } = result;

  const totalPrincipal = loans.reduce((s, l) => s + Number(l.principal), 0);
  const totalOutstanding = loans.reduce((s, l) => s + Number(l.outstanding ?? 0), 0);
  const activeCount = loans.filter((l) => l.status === "active").length;

  const isDept = scope === "department";

  return (
    <Shell user={user} tenantName={(tenant?.name as string) ?? "Wola"}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">
            {isDept ? "Department loans" : "Loan book"}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {isDept
              ? "Loans for employees in your department."
              : "All active loans across the company."}
          </p>
        </div>
      </div>

      {/* Summary stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Total loans" value={String(loans.length)} icon={Layers} accent="brand" />
        <Metric label="Active" value={String(activeCount)} icon={CheckCircle} accent="approved" />
        <Metric label="Principal" value={ugx(totalPrincipal)} icon={Banknote} accent="brand" />
        <Metric label="Outstanding" value={ugx(totalOutstanding)} sub="Scheduled" icon={Wallet} accent="brand" />
      </div>

      {loans.length === 0 ? (
        <div className="rounded-xl border border-rule bg-surface p-12 text-center shadow-theme-sm">
          <p className="text-sm text-ink-soft">
            {isDept ? "No loans in your department yet." : "No loans on the book yet."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-rule bg-surface shadow-theme-sm">
          <table className="ledger">
            <thead>
              <tr>
                <th>Borrower</th>
                <th>Product</th>
                <th className="r">Principal</th>
                <th className="r">Rate</th>
                <th className="r">Term</th>
                <th className="r">Outstanding</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loans.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div className="font-medium text-ink">{l.employee_name}</div>
                    <div className="num text-xs text-ink-faint">{l.employee_no}</div>
                  </td>
                  <td className="text-ink-soft">{l.product_name}</td>
                  <td className="r num font-semibold text-brand-700">{ugx(l.principal)}</td>
                  <td className="r num text-ink-soft">{Number(l.annual_rate).toFixed(1)}%</td>
                  <td className="r num text-ink-soft">{l.tenor_months} mo</td>
                  <td className="r num text-ink">{l.outstanding !== null ? ugx(l.outstanding) : "-"}</td>
                  <td>
                    <span className={l.status === "active" ? "chip chip--approved" : "chip"}>
                      {l.status.charAt(0).toUpperCase() + l.status.slice(1).replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="r">
                    <Link href={"/loans/" + l.id} className="text-xs font-medium text-brand-700 hover:underline">
                      Schedule &rarr;
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