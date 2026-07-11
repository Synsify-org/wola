// apps/web/src/app/loans/[id]/page.tsx — loan detail + amortization schedule.
// SECURITY: an ordinary employee may only view THEIR OWN loan. Admin roles
// (CFO/HR/CEO/dept head) may view any loan in the tenant. Without this check,
// filtering the register would be theatre — anyone could guess/paste a URL.
import { requireSession } from "@/lib/guard";

type Loan = {
  id: string; principal: string; annual_rate: string;
  tenor_months: number; status: string; start_date: string;
  employee_name: string; employee_no: string; owner_user_id: string | null;
};
type Line = {
  period_no: number; due_date: string; opening_balance: string;
  principal_due: string; interest_due: string; instalment: string; closing_balance: string;
};

const fmt = (n: number | string) => "UGX " + Math.round(Number(n)).toLocaleString();
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default async function LoanDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const data = await requireSession(async (tx, ctx) => {
    const [loan] = (await tx`
      SELECT l.id, l.principal, l.annual_rate, l.tenor_months, l.status, l.start_date,
             e.full_name AS employee_name, e.employee_no, e.user_id AS owner_user_id
      FROM loans l
      JOIN loan_applications la ON la.id = l.application_id
      JOIN employees e ON e.id = la.employee_id
      WHERE l.id = ${id}`) as unknown as Loan[];
    if (!loan) return null;

    // AUTHORIZATION: not an admin role AND not your loan => treat as not found.
    // (Return 404-equivalent rather than 403 so we don't confirm the loan exists.)
    if (!ctx.canSeeAllLoans && loan.owner_user_id !== ctx.userId) return null;

    const lines = (await tx`
      SELECT sl.period_no, sl.due_date, sl.opening_balance, sl.principal_due,
             sl.interest_due, sl.instalment, sl.closing_balance
      FROM schedule_lines sl
      JOIN loan_schedules s ON s.id = sl.schedule_id
      WHERE s.loan_id = ${id} AND s.is_active
      ORDER BY sl.period_no`) as unknown as Line[];
    return { loan, lines };
  });

  if (!data) {
    return (
      <main style={{ maxWidth: 800, margin: "6vh auto", fontFamily: "system-ui", padding: "0 16px" }}>
        <h1>Loan not found</h1>
        <a href="/loans">← Back to register</a>
      </main>
    );
  }

  const { loan, lines } = data;
  const totalInterest = lines.reduce((s, l) => s + Number(l.interest_due), 0);

  return (
    <main style={{ maxWidth: 860, margin: "5vh auto", fontFamily: "system-ui", padding: "0 16px" }}>
      <a href="/loans" style={{ fontSize: 14, color: "#666" }}>← Back to register</a>
      <h1 style={{ marginBottom: 4 }}>Loan schedule</h1>
      <p style={{ color: "#666", margin: "0 0 20px" }}>
        {loan.employee_name} ({loan.employee_no}) · Principal {fmt(loan.principal)} ·
        {" "}{(Number(loan.annual_rate) * 100).toFixed(1)}% p.a. · {loan.tenor_months} months ·
        {" "}starts {fmtDate(loan.start_date)} · <span style={{ color: "#137333" }}>{loan.status}</span>
      </p>

      <div style={{ display: "flex", gap: 32, marginBottom: 20, fontSize: 14 }}>
        <div><strong style={{ fontSize: 20 }}>{fmt(loan.principal)}</strong><div style={{ color: "#666" }}>Principal</div></div>
        <div><strong style={{ fontSize: 20 }}>{fmt(totalInterest)}</strong><div style={{ color: "#666" }}>Total interest</div></div>
        <div><strong style={{ fontSize: 20 }}>{fmt(Number(loan.principal) + totalInterest)}</strong><div style={{ color: "#666" }}>Total repayable</div></div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr style={{ color: "#666", borderBottom: "2px solid #eee" }}>
            <th style={{ padding: "8px", textAlign: "left" }}>#</th>
            <th style={{ padding: "8px", textAlign: "left" }}>Due date</th>
            <th style={{ padding: "8px", textAlign: "right" }}>Opening</th>
            <th style={{ padding: "8px", textAlign: "right" }}>Principal</th>
            <th style={{ padding: "8px", textAlign: "right" }}>Interest</th>
            <th style={{ padding: "8px", textAlign: "right" }}>Instalment</th>
            <th style={{ padding: "8px", textAlign: "right" }}>Closing</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.period_no} style={{ borderBottom: "1px solid #f5f5f5" }}>
              <td style={{ padding: "8px", textAlign: "left" }}>{l.period_no}</td>
              <td style={{ padding: "8px", textAlign: "left" }}>{fmtDate(l.due_date)}</td>
              <td style={{ padding: "8px", textAlign: "right" }}>{fmt(l.opening_balance)}</td>
              <td style={{ padding: "8px", textAlign: "right" }}>{fmt(l.principal_due)}</td>
              <td style={{ padding: "8px", textAlign: "right" }}>{fmt(l.interest_due)}</td>
              <td style={{ padding: "8px", textAlign: "right" }}>{fmt(l.instalment)}</td>
              <td style={{ padding: "8px", textAlign: "right" }}>{fmt(l.closing_balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}