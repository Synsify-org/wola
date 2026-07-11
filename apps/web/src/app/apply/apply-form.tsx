// apps/web/src/app/apply/apply-form.tsx — client component, live eligibility.
"use client";
import { useState, useMemo } from "react";
import { assessEligibility, type LoanKind, type EmployeeFinancials } from "@wola/engine";

type Profile = EmployeeFinancials & {
  fullName: string; employeeNo: string; title: string | null;
  department: string | null; departmentHead: string | null;
};

const LOANS: { kind: LoanKind; label: string; blurb: string }[] = [
  { kind: "advance", label: "Salary Advance", blurb: "Up to 1 month gross. Interest-free. Repaid in 3 months." },
  { kind: "development", label: "Development Loan", blurb: "Up to 3× gross. CBR interest. Up to 36 months." },
  { kind: "car", label: "Staff Car Loan", blurb: "Paid to vendor. CBR interest. Up to 36 months." },
];

const fmt = (n: number) => "UGX " + Math.round(n).toLocaleString();

export default function ApplyForm({ profile }: { profile: Profile }) {
  const [kind, setKind] = useState<LoanKind>("advance");
  const [externalRecoveries, setExternalRecoveries] = useState(0);
  const [amount, setAmount] = useState(0);
  const [tenor, setTenor] = useState(3);

  // Live eligibility — recomputes on every change. External recoveries only
  // matter for the car loan (declared per spec).
  const result = useMemo(() => assessEligibility(kind, {
    ...profile,
    externalRecoveries: kind === "car" ? externalRecoveries : 0,
  }), [kind, externalRecoveries, profile]);

  const overCap = amount > result.maxAmount;
  const canSubmit = result.eligible && amount > 0 && !overCap;

  return (
    <main style={{ maxWidth: 640, margin: "5vh auto", fontFamily: "system-ui", padding: "0 16px" }}>
      <h1 style={{ marginBottom: 4 }}>Apply for a loan</h1>
      <p style={{ color: "#666", margin: "0 0 20px" }}>
        {profile.fullName} · {profile.employeeNo} · {profile.title ?? "—"} · {profile.department ?? "—"}
      </p>

      {/* Loan type picker */}
      <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
        {LOANS.map((l) => (
          <button key={l.kind} onClick={() => { setKind(l.kind); setAmount(0); }}
            style={{
              textAlign: "left", padding: 12, borderRadius: 8, cursor: "pointer",
              border: kind === l.kind ? "2px solid #137333" : "1px solid #ddd",
              background: kind === l.kind ? "#f0f9f2" : "#fff",
            }}>
            <strong>{l.label}</strong>
            <div style={{ fontSize: 13, color: "#666" }}>{l.blurb}</div>
          </button>
        ))}
      </div>

      {/* Car loan: declare external loans */}
      {kind === "car" && (
        <label style={{ display: "block", marginBottom: 16, fontSize: 14 }}>
          Declared external loans (banks/SACCOs), monthly recovery:
          <input type="number" value={externalRecoveries}
            onChange={(e) => setExternalRecoveries(Number(e.target.value) || 0)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }} />
        </label>
      )}

      {/* Eligibility result */}
      {!result.eligible ? (
        <div style={{ padding: 12, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, marginBottom: 16 }}>
          {result.reasons.map((r, i) => <div key={i} style={{ color: "#991b1b", fontSize: 14 }}>{r}</div>)}
        </div>
      ) : (
        <>
          <p style={{ fontSize: 14, color: "#137333", marginBottom: 8 }}>
            You qualify for up to <strong>{fmt(result.maxAmount)}</strong>
            {result.interestApplies ? " (interest applies at CBR)" : " (interest-free)"}.
          </p>
          <label style={{ display: "block", marginBottom: 8, fontSize: 14 }}>
            Amount: <strong>{fmt(amount)}</strong>
            <input type="range" min={0} max={result.maxAmount} step={100000}
              value={amount} onChange={(e) => setAmount(Number(e.target.value))}
              style={{ display: "block", width: "100%", marginTop: 4 }} />
          </label>
          <label style={{ display: "block", marginBottom: 16, fontSize: 14 }}>
            Repayment period: {tenor} months
            <input type="range" min={1} max={result.maxTenorMonths} step={1}
              value={tenor} onChange={(e) => setTenor(Number(e.target.value))}
              style={{ display: "block", width: "100%", marginTop: 4 }} />
          </label>
        </>
      )}

      <form action="/api/apply" method="post">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="amount" value={amount} />
        <input type="hidden" name="tenor" value={tenor} />
        <input type="hidden" name="externalRecoveries" value={kind === "car" ? externalRecoveries : 0} />
        <button type="submit" disabled={!canSubmit}
          style={{
            padding: "10px 20px", borderRadius: 8, border: "none",
            background: canSubmit ? "#137333" : "#ccc",
            color: "#fff", cursor: canSubmit ? "pointer" : "not-allowed",
          }}>
          Submit application
        </button>
      </form>
    </main>
  );
}