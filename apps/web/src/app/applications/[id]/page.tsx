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
      SELECT a.decision, a.comment, u.email AS approver
      FROM approvals a LEFT JOIN users u ON u.id = a.approver_user_id
      WHERE a.application_id = ${id} ORDER BY a.created_at`;

    return { ...loaded, isMyTurn, meta, decisions };
  });

  if (!data) {
    return (
      <main className="page">
        <h1>No such application</h1>
        <p><a href="/approvals">Back to approvals</a></p>
      </main>
    );
  }

  const { app, routing, isMyTurn, meta, decisions } = data;
  const doneIds = new Set(routing.completed.map((s) => s.id));
  const rejected = routing.state === "rejected";

  return (
    <main className="page">
      <p className="eyebrow"><a href="/approvals">Approvals</a></p>

      <h1>{meta.product_name}</h1>
      <p style={{ color: "var(--ink-soft)", marginTop: "var(--s-2)" }}>
        {meta.full_name} · <span className="num">{meta.employee_no}</span>
      </p>

      <div className="figures">
        <div className="figure">
          <span className="v">{fmt(app.amount)}</span>
          <span className="k">Requested</span>
        </div>
        <div className="figure">
          <span className="v">{app.tenorMonths}</span>
          <span className="k">Months</span>
        </div>
        <div className="figure">
          <span className="v" style={{
            color: rejected ? "var(--void)"
                 : routing.state === "approved" ? "var(--stamp)"
                 : "var(--pending)",
            fontSize: "var(--step-1)",
          }}>
            {routing.state}
          </span>
          <span className="k">Status</span>
        </div>
      </div>

      {/* ── The stamp trail. Who has signed, who holds it now. ── */}
      <div className="trail" aria-label="Approval chain">
        {routing.stages.map((s, i) => {
          const done = doneIds.has(s.id);
          const now = routing.currentStage?.id === s.id;
          const voided = rejected && routing.rejectedAt?.id === s.id;
          const cls = voided ? "stamp stamp--void"
                    : done ? "stamp stamp--done"
                    : now ? "stamp stamp--now"
                    : "stamp stamp--next";
          return (
            <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: "var(--s-3)" }}>
              <span className={cls}>
                {done && <span className="mark">✓</span>}
                {voided && <span className="mark">✕</span>}
                {label(s.approverRole)}
              </span>
              {i < routing.stages.length - 1 && <span className="arrow">→</span>}
            </span>
          );
        })}
      </div>

      {error && <p className="notice">{error}</p>}

      {decisions.length > 0 && (
        <section style={{ marginBottom: "var(--s-6)" }}>
          <h2 style={{ marginBottom: "var(--s-3)" }}>Decisions</h2>
          <table className="ledger">
            <tbody>
              {decisions.map((d, i) => (
                <tr key={i}>
                  <td style={{
                    color: d.decision === "rejected" ? "var(--void)" : "var(--stamp)",
                    fontWeight: 500, width: "8rem",
                  }}>
                    {d.decision}
                  </td>
                  <td>
                    {d.approver}
                    {d.comment && (
                      <div style={{ color: "var(--ink-soft)", fontSize: "var(--step--1)" }}>
                        {d.comment}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {isMyTurn && routing.currentStage && (
        <form action={decideAction} style={{ display: "grid", gap: "var(--s-4)" }}>
          <input type="hidden" name="applicationId" value={app.applicationId} />
          <label>
            <span className="eyebrow">Comment — required to reject</span>
            <textarea name="comment" rows={3} className="field"
              style={{ marginTop: "var(--s-2)" }} />
          </label>
          <div style={{ display: "flex", gap: "var(--s-3)" }}>
            <button type="submit" name="decision" value="approved" className="btn btn--approve">
              Approve
            </button>
            <button type="submit" name="decision" value="rejected" className="btn btn--reject">
              Reject
            </button>
          </div>
        </form>
      )}

      {!isMyTurn && routing.state === "pending" && (
        <p style={{ color: "var(--ink-soft)" }}>
          With {label(routing.currentStage!.approverRole)}.
        </p>
      )}
    </main>
  );
}