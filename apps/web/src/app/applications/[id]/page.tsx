// apps/web/src/app/applications/[id]/page.tsx
// Shows an application, WHERE it sits in the approval chain, and — if this
// viewer is the current approver — the approve/reject actions.
import { requireSession } from "@/lib/guard";
import { routeApplication } from "@wola/db";
import { canAct } from "@wola/engine";
import { decideAction } from "./actions";

const fmt = (n: number) => "UGX " + Math.round(n).toLocaleString();
const label = (r: string) => r.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default async function ApplicationDetail({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  const data = await requireSession(async (tx, ctx) => {
    const loaded = await routeApplication(tx, id);
    if (!loaded) return null;

    const [me] = await tx`SELECT id FROM employees WHERE user_id = ${ctx.userId}`;
    const actor = { userId: ctx.userId, employeeId: (me?.id as string) ?? null, role: ctx.role };
    const applicant = {
      employeeId: loaded.app.employeeId,
      role: loaded.app.applicantRole,
      departmentHeadId: loaded.app.departmentHeadId,
    };
    const isMyTurn = loaded.routing.currentStage
      ? canAct(loaded.routing.currentStage, actor, applicant)
      : false;

    const [meta] = await tx`
      SELECT e.full_name, e.employee_no, lp.name AS product_name
      FROM loan_applications la
      JOIN employees e ON e.id = la.employee_id
      JOIN loan_products lp ON lp.id = la.loan_product_id
      WHERE la.id = ${id}`;

    const decisions = await tx`
      SELECT a.stage_id, a.decision, a.comment, u.email AS approver
      FROM approvals a LEFT JOIN users u ON u.id = a.approver_user_id
      WHERE a.application_id = ${id} ORDER BY a.created_at`;

    return { ...loaded, isMyTurn, meta, decisions };
  });

  if (!data) {
    return (
      <main style={{ maxWidth: 720, margin: "6vh auto", fontFamily: "system-ui", padding: "0 16px" }}>
        <h1>Application not found</h1><a href="/approvals">← Back</a>
      </main>
    );
  }

  const { app, routing, isMyTurn, meta, decisions } = data;
  const doneIds = new Set(routing.completed.map((s) => s.id));

  return (
    <main style={{ maxWidth: 720, margin: "5vh auto", fontFamily: "system-ui", padding: "0 16px" }}>
      <a href="/approvals" style={{ fontSize: 14, color: "#666" }}>← Approvals</a>
      <h1 style={{ marginBottom: 4 }}>{meta.product_name}</h1>
      <p style={{ color: "#666", margin: "0 0 20px" }}>
        {meta.full_name} ({meta.employee_no}) · {fmt(app.amount)} over {app.tenorMonths} months ·{" "}
        <strong style={{
          color: routing.state === "approved" ? "#137333"
               : routing.state === "rejected" ? "#b3261e" : "#8a6d00",
        }}>{routing.state}</strong>
      </p>

      {error && (
        <div style={{ padding: 12, background: "#fef2f2", border: "1px solid #fca5a5",
                      borderRadius: 8, marginBottom: 16, color: "#991b1b", fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* Approval chain — who has it, who's next */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "0 0 24px" }}>
        {routing.stages.map((s, i) => {
          const done = doneIds.has(s.id);
          const current = routing.currentStage?.id === s.id;
          return (
            <span key={s.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                padding: "6px 12px", borderRadius: 20, fontSize: 13,
                background: done ? "#e6f4ea" : current ? "#fff4e5" : "#f5f5f5",
                border: current ? "1px solid #f0a500" : "1px solid transparent",
                color: done ? "#137333" : current ? "#8a6d00" : "#999",
                fontWeight: current ? 600 : 400,
              }}>
                {done ? "✓ " : ""}{label(s.approverRole)}
              </span>
              {i < routing.stages.length - 1 && <span style={{ color: "#ccc" }}>→</span>}
            </span>
          );
        })}
      </div>

      {/* Decision history */}
      {decisions.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 14, color: "#666", marginBottom: 8 }}>Decisions</h2>
          {decisions.map((d, i) => (
            <div key={i} style={{ fontSize: 13, padding: "6px 0", borderBottom: "1px solid #f5f5f5" }}>
              <strong style={{ color: d.decision === "rejected" ? "#b3261e" : "#137333" }}>
                {d.decision}
              </strong>{" "}
              by {d.approver}
              {d.comment && <div style={{ color: "#666" }}>{d.comment}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Actions — only for the person whose turn it actually is */}
      {isMyTurn && routing.currentStage && (
        <form action={decideAction} style={{ display: "grid", gap: 12 }}>
          <input type="hidden" name="applicationId" value={app.applicationId} />
          <textarea name="comment" placeholder="Comment (required if rejecting)"
            style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd",
                     fontFamily: "inherit", minHeight: 70 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" name="decision" value="approved"
              style={{ padding: "10px 20px", borderRadius: 8, border: "none",
                       background: "#137333", color: "#fff", cursor: "pointer" }}>
              Approve
            </button>
            <button type="submit" name="decision" value="rejected"
              style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid #b3261e",
                       background: "#fff", color: "#b3261e", cursor: "pointer" }}>
              Reject
            </button>
          </div>
        </form>
      )}

      {!isMyTurn && routing.state === "pending" && (
        <p style={{ color: "#666", fontSize: 14 }}>
          Awaiting {label(routing.currentStage!.approverRole)}.
        </p>
      )}
    </main>
  );
}