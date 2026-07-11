// apps/web/src/app/loans/page.tsx — loan register.
// Role-based: admin roles (CFO/HR/CEO/dept head) see all loans in the tenant;
// ordinary employees see ONLY their own. Fail closed — unknown role = employee.
//
// NOTE ON "OUTSTANDING": scheduled balance (closing balance of the last period
// whose due date has passed, else full principal). Assumes on-schedule payment.
// TRUE outstanding needs the repayments table. Revisit when that exists.
import { requireSession } from "@/lib/guard";

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

const fmt = (n: number | string) => "UGX " + Math.round(Number(n)).toLocaleString();
const cell: React.CSSProperties = { padding: "10px 8px" };
const cellRight: React.CSSProperties = { padding: "10px 8px", textAlign: "right" };
const head: React.CSSProperties = { padding: "8px", color: "#666", fontWeight: 600 };
const headRight: React.CSSProperties = { padding: "8px", color: "#666", fontWeight: 600, textAlign: "right" };

export default async function LoanRegister() {
  const { loans, canSeeAll } = await requireSession(async (tx, ctx) => {
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
      -- Employees see only loans tied to THEIR employee record.
      WHERE ${ctx.canSeeAllLoans ? tx`TRUE` : tx`e.user_id = ${ctx.userId}`}
      ORDER BY l.created_at DESC`) as unknown as Row[];
    return { loans: rows, canSeeAll: ctx.canSeeAllLoans };
  });

  const totalPrincipal = loans.reduce((s, l) => s + Number(l.principal), 0);
  const totalOutstanding = loans.reduce((s, l) => s + Number(l.outstanding ?? 0), 0);
  const activeCount = loans.filter((l) => l.status === "active").length;

  return (
    <main style={{ maxWidth: 1000, margin: "5vh auto", fontFamily: "system-ui", padding: "0 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{canSeeAll ? "Loan register" : "My loans"}</h1>
          {!canSeeAll && <p style={{ color: "#666", fontSize: 13, margin: 0 }}>Showing your loans only.</p>}
        </div>
        <a href="/apply" style={{ fontSize: 14 }}>+ New application</a>
      </div>

      <div style={{ display: "flex", gap: 32, margin: "16px 0 24px", fontSize: 14 }}>
        <div><strong style={{ fontSize: 20 }}>{loans.length}</strong><div style={{ color: "#666" }}>Total loans</div></div>
        <div><strong style={{ fontSize: 20 }}>{activeCount}</strong><div style={{ color: "#666" }}>Active</div></div>
        <div><strong style={{ fontSize: 20 }}>{fmt(totalPrincipal)}</strong><div style={{ color: "#666" }}>Principal</div></div>
        <div><strong style={{ fontSize: 20 }}>{fmt(totalOutstanding)}</strong><div style={{ color: "#666" }}>Outstanding (scheduled)</div></div>
      </div>

      {loans.length === 0 ? (
        <p style={{ color: "#666" }}>No loans yet. <a href="/apply">Apply for one</a>.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #eee" }}>
              {canSeeAll && <th style={{ ...head, textAlign: "left" }}>Employee</th>}
              <th style={{ ...head, textAlign: "left" }}>Product</th>
              <th style={headRight}>Principal</th>
              <th style={headRight}>Rate</th>
              <th style={headRight}>Term</th>
              <th style={headRight}>Outstanding</th>
              <th style={{ ...head, textAlign: "left" }}>Status</th>
              <th style={head}></th>
            </tr>
          </thead>
          <tbody>
            {loans.map((l) => (
              <tr key={l.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                {canSeeAll && (
                  <td style={cell}>
                    {l.employee_name}
                    <div style={{ color: "#999", fontSize: 12 }}>{l.employee_no}</div>
                  </td>
                )}
                <td style={cell}>{l.product_name}</td>
                <td style={cellRight}>{fmt(l.principal)}</td>
                <td style={cellRight}>{(Number(l.annual_rate) * 100).toFixed(1)}%</td>
                <td style={cellRight}>{l.tenor_months} mo</td>
                <td style={cellRight}>{l.outstanding !== null ? fmt(l.outstanding) : "—"}</td>
                <td style={cell}>
                  <span style={{ color: l.status === "active" ? "#137333" : "#666" }}>{l.status}</span>
                </td>
                <td style={cell}>
                  <a href={`/loans/${l.id}`} style={{ fontSize: 12, whiteSpace: "nowrap" }}>Schedule →</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}