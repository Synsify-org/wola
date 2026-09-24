// apps/web/src/app/loans/page.tsx - loan register.
// Role-based: admin roles see all loans; employees see only their own.
// "Outstanding" = principal minus the repayment LEDGER (actual money in),
// matching loanOutstanding() in @wola/db — not a schedule projection.
import { requireSession, scopePredicate } from "@/lib/guard";
import Link from "next/link";
import Metric from "@/components/metric";
import { Layers, CheckCircle, Banknote, Wallet } from "lucide-react";
import { formatMoney } from "@wola/engine";
import { getTenantCurrency } from "@/lib/tenant";

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

export default async function LoanRegister() {
  const currency = await getTenantCurrency();
  const ugx = (n: number | string) => formatMoney(Number(n), currency);
  const loans = await requireSession(async (tx, ctx) => {
    const rows = (await tx`
      SELECT l.id, l.principal, l.annual_rate, l.tenor_months, l.status, l.start_date,
             e.full_name AS employee_name, e.employee_no,
             lp.name AS product_name,
             GREATEST(l.principal - COALESCE(
               (SELECT sum((r.allocation->>'principal')::numeric)
                  FROM repayments r WHERE r.loan_id = l.id),
               0
             ), 0) AS outstanding
      FROM loans l
      JOIN loan_applications la ON la.id = l.application_id
      JOIN employees e ON e.id = la.employee_id
      JOIN loan_products lp ON lp.id = la.loan_product_id
      WHERE ${scopePredicate(tx, ctx, "own")}
      ORDER BY l.created_at DESC`) as unknown as Row[];
    return rows;
  });

  const totalPrincipal = loans.reduce((s, l) => s + Number(l.principal), 0);
  const totalOutstanding = loans.reduce((s, l) => s + Number(l.outstanding ?? 0), 0);
  const activeCount = loans.filter((l) => l.status === "active").length;

  const Stat = ({ label, value }: { label: string; value: string }) => (
    <div className="rounded-xl border border-rule bg-surface p-4 shadow-theme-sm">
      <div className="caps">{label}</div>
      <div className="num mt-2 text-xl font-bold text-ink">{value}</div>
    </div>
  );

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">My loans</h1>
          <p className="mt-1 text-sm text-ink-soft">Showing your loans only.</p>
        </div>
        <Link href="/apply" className="btn btn--primary rounded-lg text-sm">+ New application</Link>
      </div>

      {/* Summary stats */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total loans" value={String(loans.length)} icon={Layers} accent="brand" />
        <Metric label="Active" value={String(activeCount)} icon={CheckCircle} accent="approved" />
        <Metric label="Principal" value={ugx(totalPrincipal)} icon={Banknote} accent="brand" />
        <Metric label="Outstanding" value={ugx(totalOutstanding)} sub="Ledger" icon={Wallet} accent="brand" />
      </div>

      {loans.length === 0 ? (
        <div className="rounded-xl border border-rule bg-surface p-12 text-center shadow-theme-sm">
          <p className="text-sm text-ink-soft">No loans yet.</p>
          <Link href="/apply" className="mt-3 inline-block text-sm font-medium text-brand hover:underline">
            Apply for one
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-rule bg-surface shadow-theme-xs">
          <table className="ledger">
            <thead>
              <tr>
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
                  <td className="text-ink-soft">{l.product_name}</td>
                  <td className="r num font-semibold text-brand-700">{ugx(l.principal)}</td>
                  {/* annual_rate is stored as a fraction (0.16 = 16%) — see
                      resolveRate() in approvals.ts. */}
                  <td className="r num text-ink-soft">{(Number(l.annual_rate) * 100).toFixed(1)}%</td>
                  <td className="r num text-ink-soft">{l.tenor_months} mo</td>
                  <td className="r num text-ink">{l.outstanding !== null ? ugx(l.outstanding) : "-"}</td>
                  <td>
                    <span className={l.status === "active" ? "chip chip--approved" : "chip"}>
                      {l.status.charAt(0).toUpperCase() + l.status.slice(1)}
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
    </>
  );
}