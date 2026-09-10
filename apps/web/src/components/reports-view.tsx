"use client";
import { FileDown, FileText, Printer, ShieldAlert, TrendingUp, Users2 } from "lucide-react";
import DashboardCard from "./dashboard-card";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();
const shortDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "-";
const shortDateTime = (d: string | null) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
const label = (r: string) => r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

type Book = { totalExposure: number; activeLoans: number; principalDisbursed: number; interestBook: number };
type Loan = { borrower: string; employeeNo: string; department: string; product: string; principal: number; rate: number; tenor: number; outstanding: number; arrears: number };
type App = { applicant: string; employeeNo: string; product: string; amount: number; tenor: number; status: string; applied: string | null };
type Dept = { department: string; n: number; principal: number };
type TopBorrower = { borrower: string; employeeNo: string; outstanding: number };
type TrailRow = { borrower: string; employeeNo: string; product: string; decision: string; comment: string | null; decidedAt: string | null; stageRole: string; approverEmail: string };

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
  book, loans, applications, departments, tenantName, brandPrimary, brandAccent,
  totalArrears, overdueCount, parRatio, actualInterestCollected, topBorrowers, approvalTrail,
}: {
  book: Book;
  loans: Loan[];
  applications: App[];
  departments: Dept[];
  tenantName: string;
  brandPrimary: string;
  brandAccent: string;
  totalArrears: number;
  overdueCount: number;
  parRatio: number;
  actualInterestCollected: number;
  topBorrowers: TopBorrower[];
  approvalTrail: TrailRow[];
}) {
  const now = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const totalOutstanding = loans.reduce((s, l) => s + l.outstanding, 0);
  const interestCollectionRate = book.interestBook > 0 ? Math.round((actualInterestCollected / book.interestBook) * 100) : 0;

  const exportLoans = () =>
    downloadCSV("wola-loan-register.csv", [
      ["Borrower", "Employee No", "Department", "Product", "Principal", "Rate %", "Tenor (mo)", "Outstanding", "Arrears"],
      ...loans.map((l) => [l.borrower, l.employeeNo, l.department, l.product, l.principal, l.rate.toFixed(1), l.tenor, l.outstanding, l.arrears]),
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

  const exportTrail = () =>
    downloadCSV("wola-approval-audit-trail.csv", [
      ["Borrower", "Employee No", "Product", "Stage", "Decision", "Approver", "Decided At", "Comment"],
      ...approvalTrail.map((t) => [t.borrower, t.employeeNo, t.product, label(t.stageRole), label(t.decision), t.approverEmail, shortDateTime(t.decidedAt), t.comment ?? ""]),
    ]);

  return (
    <div className="space-y-6">
      {/* Branded header — tenant's actual white-label colours, not a generic
          treatment. A colour band + formal framing for a document that's
          meant to leave the app (print/board pack), not just live on-screen. */}
      <div className="overflow-hidden rounded-xl border border-rule bg-surface shadow-theme-sm">
        <div className="h-2 w-full" style={{ background: `linear-gradient(90deg, ${brandPrimary}, ${brandAccent})` }} />
        <div className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white" style={{ background: brandPrimary }}>
                <FileText className="h-6 w-6" />
              </span>
              <div>
                <p className="caps">Confidential — board & audit report</p>
                <h1 className="mt-0.5 text-2xl font-bold text-ink">{tenantName}</h1>
                <p className="mt-0.5 text-sm text-ink-soft">Portfolio report · Prepared {now}</p>
              </div>
            </div>
            <button
              onClick={() => window.print()}
              className="no-print inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: brandPrimary }}
            >
              <Printer className="h-4 w-4" /> Download PDF
            </button>
          </div>

          {/* Executive summary */}
          <dl className="mt-6 grid grid-cols-2 gap-6 border-t border-rule pt-5 sm:grid-cols-3 xl:grid-cols-6">
            <div className="min-w-0">
              <dt className="caps">Total exposure</dt>
              <dd className="num mt-1 truncate text-lg font-bold text-ink" title={ugx(book.totalExposure)}>{ugx(book.totalExposure)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="caps">Active loans</dt>
              <dd className="num mt-1 truncate text-lg font-bold text-ink">{book.activeLoans}</dd>
            </div>
            <div className="min-w-0">
              <dt className="caps">Principal disbursed</dt>
              <dd className="num mt-1 truncate text-lg font-bold text-ink" title={ugx(book.principalDisbursed)}>{ugx(book.principalDisbursed)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="caps">Outstanding (ledger)</dt>
              <dd className="num mt-1 truncate text-lg font-bold text-ink" title={ugx(totalOutstanding)}>{ugx(totalOutstanding)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="caps">Portfolio at risk</dt>
              <dd className="num mt-1 truncate text-lg font-bold" style={{ color: parRatio > 5 ? "var(--color-rejected)" : "var(--color-ink)" }}>
                {parRatio.toFixed(1)}%
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="caps">Interest collected</dt>
              <dd className="num mt-1 truncate text-lg font-bold text-ink">{interestCollectionRate}%</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Portfolio at risk detail */}
      <div className="grid gap-4 lg:grid-cols-3">
        <DashboardCard title="Portfolio at risk">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-error-100 text-error-700">
              <ShieldAlert className="h-5 w-5" />
            </span>
            <div>
              <div className="num text-2xl font-bold text-ink">{ugx(totalArrears)}</div>
              <p className="mt-1 text-xs text-ink-soft">
                {overdueCount} loan{overdueCount === 1 ? "" : "s"} in arrears — instalments due to date, unpaid.
                Not a projection: derived from the repayment ledger.
              </p>
            </div>
          </div>
        </DashboardCard>

        <DashboardCard title="Interest collection">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-success-100 text-success-700">
              <TrendingUp className="h-5 w-5" />
            </span>
            <div>
              <div className="num text-2xl font-bold text-ink">{ugx(actualInterestCollected)}</div>
              <p className="mt-1 text-xs text-ink-soft">
                actually collected, of {ugx(book.interestBook)} projected if every current loan runs to term.
              </p>
            </div>
          </div>
        </DashboardCard>

        <DashboardCard title="Exposure concentration">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700">
              <Users2 className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-ink-soft">Top 5 borrowers by outstanding</p>
              <ul className="mt-2 space-y-1">
                {topBorrowers.map((b) => (
                  <li key={b.employeeNo} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-ink" title={b.borrower}>{b.borrower}</span>
                    <span className="num shrink-0 font-medium text-ink">{ugx(b.outstanding)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </DashboardCard>
      </div>

      {/* Loan register */}
      <section className="overflow-hidden rounded-xl border border-rule bg-surface shadow-theme-sm">
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="caps">Loan register ({loans.length})</div>
          <button onClick={exportLoans} className="no-print inline-flex items-center gap-1.5 rounded-lg border border-rule bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-brand-50 hover:text-brand-700">
            <FileDown className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
        <table className="ledger mt-2">
          <thead>
            <tr>
              <th>Borrower</th><th>Department</th><th>Product</th>
              <th className="r">Principal</th><th className="r">Rate</th><th className="r">Outstanding</th><th className="r">Arrears</th>
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
                <td className="r num" style={l.arrears > 0.01 ? { color: "var(--color-rejected)", fontWeight: 600 } : undefined}>
                  {l.arrears > 0.01 ? ugx(l.arrears) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Department exposure */}
      <section className="overflow-hidden rounded-xl border border-rule bg-surface shadow-theme-sm">
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="caps">Exposure by department</div>
          <button onClick={exportDepts} className="no-print inline-flex items-center gap-1.5 rounded-lg border border-rule bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-brand-50 hover:text-brand-700">
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
          <button onClick={exportApps} className="no-print inline-flex items-center gap-1.5 rounded-lg border border-rule bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-brand-50 hover:text-brand-700">
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

      {/* Approval audit trail — the paper trail an audit actually asks for */}
      <section className="overflow-hidden rounded-xl border border-rule bg-surface shadow-theme-sm">
        <div className="flex items-center justify-between px-5 pt-4">
          <div>
            <div className="caps">Approval audit trail ({approvalTrail.length})</div>
            <p className="mt-0.5 text-xs text-ink-faint">Every decision, most recent first — who, what stage, when.</p>
          </div>
          <button onClick={exportTrail} className="no-print inline-flex items-center gap-1.5 rounded-lg border border-rule bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-brand-50 hover:text-brand-700">
            <FileDown className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
        <table className="ledger mt-2">
          <thead><tr><th>Borrower</th><th>Product</th><th>Stage</th><th>Decision</th><th>Approver</th><th className="r">Decided</th></tr></thead>
          <tbody>
            {approvalTrail.map((t, i) => (
              <tr key={i}>
                <td><div className="font-medium text-ink">{t.borrower}</div><div className="num text-xs text-ink-faint">{t.employeeNo}</div></td>
                <td className="text-ink-soft">{t.product}</td>
                <td className="text-ink-soft">{label(t.stageRole)}</td>
                <td><span className={t.decision === "approved" ? "chip chip--approved" : "chip chip--rejected"}>{label(t.decision)}</span></td>
                <td className="text-ink-soft">{t.approverEmail}</td>
                <td className="r num text-ink-soft whitespace-nowrap">{shortDateTime(t.decidedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
