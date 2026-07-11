// apps/web/src/app/loans/[id]/page.tsx — loan detail + amortization schedule.
// Guarded and tenant-scoped: loads the loan and its active schedule lines.
import { requireSession } from "@/lib/guard";

type Loan = {
  id: string; principal: string; annual_rate: string;
  tenor_months: number; status: string; start_date: string;
};
type Line = {
  period_no: number; due_date: string; opening_balance: string;
  principal_due: string; interest_due: string; instalment: string; closing_balance: string;
};

const fmt = (n: number | string) => "UGX " + Math.round(Number(n)).toLocaleString();
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default async function LoanDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const data = await requireSession(async (tx) => {
    const [loan] = await tx`
      SELECT id, principal, annual_rate, tenor_months, status, start_date
      FROM loans WHERE id = ${id}` as unknown as Loan[];
    if (!loan) return null;
    const lines = await tx`
      SELECT sl.period_no, sl.due_date, sl.opening_balance, sl.principal_due,
             sl.interest_due, sl.instalment, sl.closing_balance
      FROM schedule_lines sl
      JOIN loan_schedules s ON s.id = sl.schedule_id
      WHERE s.loan_id = ${id} AND s.is_active
      ORDER BY sl.period_no` as unknown as Line[];
    return { loan, lines };
  });

  if (!data) {
    return (
      <main style={{ maxWidth: 800, margin: "6vh auto", fontFamily: "system-ui", padding: "0 16px" }}>
        <h1>Loan not found</h1>
        <a href="/">← Back</a>
      </main>
    );
  }

  const { loan, lines } = data;
  const totalInterest = lines.reduce((s, l) => s + Number(l.interest_due), 0);

  return (
    <main style={{ maxWidth: 800, margin: "5vh auto", fontFamily: "system-ui", padding: "0 16px" }}>
      <a href="/" style={{ fontSize: 14, color: "#666" }}>← Back</a>
      <h1 style={{ marginBottom: 4 }}>Loan schedule</h1>
      <p style={{ color: "#666", margin: "0 0 20px" }}>
        Principal {fmt(loan.principal)} · {(Number(loan.annual_rate) * 100).toFixed(1)}% p.a. ·
        {" "}{loan.tenor_months} months · starts {fmtDate(loan.start_date)} ·
        {" "}<span style={{ color: "#137333" }}>{loan.status}</span>
      </p>

      <div style={{ display: "flex", gap: 24, marginBottom: 20, fontSize: 14 }}>
        <div><strong>{fmt(loan.principal)}</strong><div style={{ color: "#666" }}>Principal</div></div>
        <div><strong>{fmt(totalInterest)}</strong><div style={{ color: "#666" }}>Total interest</div></div>
        <div><strong>{fmt(Number(loan.principal) + totalInterest)}</strong><div style={{ color: "#666" }}>Total repayable</div></div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr style={{ textAlign: "right", color: "#666", borderBottom: "2px solid #eee" }}>
            <th style={{ textAlign: "left", padding: "8px 4px" }}>#</th>
            <th style={{ textAlign: "left" }}>Due date</th>
            <th>Opening</th><th>Principal</th><th>Interest</th><th>Instalment</th><th>Closing</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.period_no} style={{ textAlign: "right", borderBottom: "1px solid #f5f5f5" }}>
              <td style={{ textAlign: "left", padding: "6px 4px" }}>{l.period_no}</td>
              <td style={{ textAlign: "left" }}>{fmtDate(l.due_date)}</td>
              <td>{fmt(l.opening_balance)}</td>
              <td>{fmt(l.principal_due)}</td>
              <td>{fmt(l.interest_due)}</td>
              <td>{fmt(l.instalment)}</td>
              <td>{fmt(l.closing_balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}