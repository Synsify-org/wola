"use client";
import { FileDown, FileText, Printer } from "lucide-react";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();
const shortDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "-";
const label = (r: string) => r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

type Book = { totalExposure: number; activeLoans: number; principalDisbursed: number; interestBook: number };
type Loan = { borrower: string; employeeNo: string; department: string; product: string; principal: number; rate: number; tenor: number; outstanding: number };
type App = { applicant: string; employeeNo: string; product: string; amount: number; tenor: number; status: string; applied: string | null };
type Dept = { department: string; n: number; principal: number };

function downloadCSV(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsView({
  book, loans, applications, departments, tenantName,
}: {
  book: Book;
  loans: Loan[];
  applications: App[];
  departments: Dept[];
  tenantName: string;
}) {
  const now = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const totalOutstanding = loans.reduce((s, l) => s + l.outstanding, 0);

  const exportLoans = () =>
    downloadCSV("wola-loan-register.csv", [
      ["Borrower", "Employee No", "Department", "Product", "Principal", "Rate %", "Tenor (mo)", "Outstanding"],
      ...loans.map((l) => [l.borrower, l.employeeNo, l.department, l.product, l.principal, l.rate.toFixed(1), l.tenor, l.outstanding]),
    ]);

  const exportApps = () =>
    downloadCSV("wola-applications.csv", [
      ["Applicant", "Employee No", "Product", "Amount", "Tenor (mo)", "Status", "Applied"],
      ...applications.map((a) => [a.applicant, a.employeeNo, a.product, a.amount, a.tenor, label(a.status), shortDate(a.applied)]),
    ]);

  const exportDepts = () =>
    downloadCSV("wola-department-exposure.csv", [
      ["Department", "Loans", "Principal"],
      ...departments.map((d) => [d.department, d.n, d.principal]),
    ]);

  return (
    <div className="space-y-6">
      {/* Report header - document style */}
      <div className="rounded-xl border border-rule bg-surface p-6 shadow-theme-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-100 text-brand-700">
              <FileText className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-ink">Portfolio Report</h1>
              <p className="mt-0.5 text-sm text-ink-soft">{tenantName}{" \u00B7 "}Generated {now}</p>
            </div>
          </div>
          <button onClick={() => window.print()} className="no-print inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-brand-ink transition-colors hover:bg-brand-deep">
            <Printer className="h-4 w-4" /> Download PDF
          </button>
        </div>

        {/* Summary block */}
        <dl className="mt-6 grid grid-cols-2 gap-6 border-t border-rule pt-5 sm:grid-cols-4">
          <div>
            <dt className="caps">Total exposure</dt>
            <dd className="num mt-1 text-lg font-bold text-ink">{ugx(book.totalExposure)}</dd>
          </div>
          <div>
            <dt className="caps">Active loans</dt>
            <dd className="num mt-1 text-lg font-bold text-ink">{book.activeLoans}</dd>
          </div>
          <div>
            <dt className="caps">Principal disbursed</dt>
            <dd className="num mt-1 text-lg font-bold text-ink">{ugx(book.principalDisbursed)}</dd>
          </div>
          <div>
            <dt className="caps">Outstanding (scheduled)</dt>
            <dd className="num mt-1 text-lg font-bold text-ink">{ugx(totalOutstanding)}</dd>
          </div>
        </dl>
      </div>

      {/* Loan register */}
      <section className="overflow-hidden rounded-xl border border-rule bg-surface shadow-theme-sm">
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="caps">Loan register ({loans.length})</div>
          <button onClick={exportLoans} className="inline-flex items-center gap-1.5 rounded-lg border border-rule bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-brand-50 hover:text-brand-700">
            <FileDown className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
        <table className="ledger mt-2">
          <thead>
            <tr>
              <th>Borrower</th><th>Department</th><th>Product</th>
              <th className="r">Principal</th><th className="r">Rate</th><th className="r">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {loans.map((l, i) => (
              <tr key={i}>
                <td><div className="font-medium text-ink">{l.borrower}</div><div className="num text-xs text-ink-faint">{l.employeeNo}</div></td>
                <td className="text-ink-soft">{l.department}</td>
                <td className="text-ink-soft">{l.product}</td>
                <td className="r num font-semibold text-brand-700">{ugx(l.principal)}</td>
                <td className="r num text-ink-soft">{l.rate.toFixed(1)}%</td>
                <td className="r num text-ink">{ugx(l.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Department exposure */}
      <section className="overflow-hidden rounded-xl border border-rule bg-surface shadow-theme-sm">
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="caps">Exposure by department</div>
          <button onClick={exportDepts} className="inline-flex items-center gap-1.5 rounded-lg border border-rule bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-brand-50 hover:text-brand-700">
            <FileDown className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
        <table className="ledger mt-2">
          <thead><tr><th>Department</th><th className="r">Loans</th><th className="r">Principal</th><th className="r">% of book</th></tr></thead>
          <tbody>
            {departments.map((d, i) => {
              const pct = book.totalExposure > 0 ? Math.round((d.principal / book.principalDisbursed) * 100) : 0;
              return (
                <tr key={i}>
                  <td className="font-medium text-ink">{d.department}</td>
                  <td className="r num text-ink-soft">{d.n}</td>
                  <td className="r num text-ink">{ugx(d.principal)}</td>
                  <td className="r num text-ink-soft">{pct}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Application register */}
      <section className="overflow-hidden rounded-xl border border-rule bg-surface shadow-theme-sm">
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="caps">Applications ({applications.length})</div>
          <button onClick={exportApps} className="inline-flex items-center gap-1.5 rounded-lg border border-rule bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-brand-50 hover:text-brand-700">
            <FileDown className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
        <table className="ledger mt-2">
          <thead><tr><th>Applicant</th><th>Product</th><th className="r">Amount</th><th>Status</th><th className="r">Applied</th></tr></thead>
          <tbody>
            {applications.map((a, i) => (
              <tr key={i}>
                <td><div className="font-medium text-ink">{a.applicant}</div><div className="num text-xs text-ink-faint">{a.employeeNo}</div></td>
                <td className="text-ink-soft">{a.product}</td>
                <td className="r num text-ink">{ugx(a.amount)}</td>
                <td><span className={a.status === "approved" ? "chip chip--approved" : a.status === "rejected" ? "chip chip--rejected" : "chip chip--awaiting"}>{label(a.status)}</span></td>
                <td className="r num text-ink-soft">{shortDate(a.applied)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
