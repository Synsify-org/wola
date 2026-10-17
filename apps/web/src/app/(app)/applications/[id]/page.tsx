import { requireSession, scopePredicate } from "@/lib/guard";
import { routeApplication, getEmployeeProfile, loadProductRules } from "@wola/db";
import { notFound } from "next/navigation";
import { canAct } from "@wola/engine";
import { decideAction } from "./actions";
import UnderwritingChecklist from "@/components/underwriting-checklist";
import StatusTimeline from "@/components/status-timeline";
import ScheduleTable from "@/components/schedule-table";
import { User, FileText } from "lucide-react";
import { formatMoney } from "@wola/engine";
import { getTenantCurrency } from "@/lib/tenant";
import { pageMeta } from "@/lib/site";
import Breadcrumbs from "@/components/breadcrumbs";
import { humanize } from "@/lib/product-summary";
import { displayPurpose } from "@/lib/purpose";

const label = humanize;

export const metadata = pageMeta({ title: "Application", description: "Review an application: the applicant, the figures, the decision timeline and the next step.", path: "/applications" });

export default async function ApplicationDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const currency = await getTenantCurrency();
  const ugx = (n: number) => formatMoney(n, currency);

  const data = await requireSession(async (tx, ctx) => {
    const loaded = await routeApplication(tx, id);
    if (!loaded) return null;

    const [meWho] = await tx`SELECT e.id FROM employees e WHERE e.user_id = ${ctx.userId}`;
    const actor = { userId: ctx.userId, employeeId: (meWho?.id as string) ?? null, role: ctx.role };
    const applicant = {
      employeeId: loaded.app.employeeId,
      role: loaded.app.applicantRole,
      departmentHeadId: loaded.app.departmentHeadId,
    };
    const isMyTurn = loaded.routing.currentStage
      ? canAct(loaded.routing.currentStage, actor, applicant)
      : false;

    // The list is role-scoped, so the detail must be too: an employee opens
    // only their own application, a dept head their department's. The
    // approver whose turn it is always may (they have to decide it).
    const [inScope] = await tx`
      SELECT 1 AS ok FROM employees e
      WHERE e.id = ${loaded.app.employeeId} AND ${scopePredicate(tx, ctx)}`;
    if (!inScope && !isMyTurn) return null;

    const [meta] = await tx`
      SELECT e.full_name, e.employee_no, e.department, e.title, e.user_id AS applicant_user_id,
             lp.name AS product_name, lp.kind AS product_kind,
             la.loan_product_id, la.declared_external_loans, la.purpose, la.created_at,
             la.eligibility_snapshot
      FROM loan_applications la
      JOIN employees e ON e.id = la.employee_id
      JOIN loan_products lp ON lp.id = la.loan_product_id
      WHERE la.id = ${id}`;

    // Name + position, not the raw email — an approver's identity to
    // someone reading the decision trail is who they are in the org, not
    // their login. Falls back to email only if no employee record exists
    // (e.g. a super-admin-only account).
    const decisions = await tx`
      SELECT a.decision, a.comment,
             COALESCE(e.full_name, u.email) AS approver_name,
             e.title AS approver_title,
             m.role AS approver_role
      FROM approvals a
      LEFT JOIN users u ON u.id = a.approver_user_id
      LEFT JOIN employees e ON e.user_id = a.approver_user_id
      LEFT JOIN memberships m ON m.user_id = a.approver_user_id AND m.tenant_id = ${ctx.tenantId}
      WHERE a.application_id = ${id} ORDER BY a.created_at`;

    const profile = meta.applicant_user_id ? await getEmployeeProfile(tx, meta.applicant_user_id as string) : null;
    const allRules = await loadProductRules(tx);
    const rules = allRules.find((r) => r.productId === meta.loan_product_id) ?? null;
    const externalDeclared =
      Array.isArray(meta.declared_external_loans) &&
      meta.declared_external_loans.length > 0;

    // Loan + amortization schedule (approved apps only). A freshly-approved
    // loan sits in 'pending_disbursement' until finance disburses it, so this
    // must not filter to 'active' only or the preview vanishes right after
    // approval. Inline stopgap - TODO @wola/db.
    const [loan] = await tx`
      SELECT id, principal, annual_rate, tenor_months, start_date
      FROM loans WHERE application_id = ${id}
        AND status IN ('active', 'pending_disbursement') LIMIT 1`;
    let schedule: Array<{ period: number; dueDate: string; instalment: number; principal: number; interest: number; balance: number }> = [];
    if (loan) {
      const lines = await tx`
        SELECT sl.period_no, sl.due_date, sl.instalment, sl.principal_due,
               sl.interest_due, sl.closing_balance
        FROM schedule_lines sl
        JOIN loan_schedules s ON s.id = sl.schedule_id
        WHERE s.loan_id = ${loan.id} AND s.is_active
        ORDER BY sl.period_no`;
      schedule = lines.map((l) => ({
        period: Number(l.period_no),
        dueDate: new Date(l.due_date as string).toISOString(),
        instalment: Number(l.instalment),
        principal: Number(l.principal_due),
        interest: Number(l.interest_due),
        balance: Number(l.closing_balance),
      }));
    }

    return { ...loaded, isMyTurn, meta, decisions, profile, rules, externalDeclared, loan, schedule };
  });

  // A missing application and one you may not see are the same real 404.
  if (!data) notFound();

  const { app, routing, isMyTurn, meta, decisions, profile, rules, externalDeclared, loan, schedule } = data;
  const doneIds = routing.completed.map((s) => s.id);
  const rejected = routing.state === "rejected";
  const statusChip =
    routing.state === "approved" ? "chip chip--approved"
    : rejected ? "chip chip--rejected"
    : "chip chip--awaiting";
  // The rate locked in when the application was submitted (applications from
  // before quoting existed have none — their rate is set at final approval).
  const snap = (meta.eligibility_snapshot ?? {}) as { annualRate?: number; interestApplies?: boolean };
  const quotedRate =
    typeof snap.annualRate === "number"
      ? snap.annualRate === 0 ? "Interest-free" : (snap.annualRate * 100).toFixed(2) + "% p.a."
      : snap.interestApplies === false
        ? "Interest-free"
        : "Set at final approval";
  const cleanPurpose = displayPurpose(meta.purpose as string | null) ?? "";
  const appliedDate = meta.created_at
    ? new Date(meta.created_at as string).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "-";

  const InfoRow = ({ k, v }: { k: string; v: string }) => (
    <div>
      <div className="text-xs text-ink-soft">{k}</div>
      <div className="num mt-0.5 text-sm font-medium text-ink">{v}</div>
    </div>
  );

  return (
    <>
      <Breadcrumbs items={[{ label: "Applications", href: "/applications" }, { label: meta.full_name as string }]} />

      {/* Rich header card */}
      <div className="mt-3 rounded-xl border border-rule bg-surface p-6 shadow-theme-sm">
        {/* Wraps on a phone (name above, amount below) and sits side by side from sm: a long
            amount can no longer push the page wider than the screen. */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-4">
          <div className="min-w-0 flex-1 basis-56">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="min-w-0 break-words text-2xl font-bold text-ink">{meta.full_name}</h1>
              <span className={statusChip}>{label(routing.state)}</span>
            </div>
            <p className="mt-1 break-words text-sm text-ink-soft">
              {meta.product_name}{cleanPurpose ? " \u00B7 " + cleanPurpose : ""}
            </p>
            <p className="mt-1 text-xs text-ink-faint">Applied {appliedDate}</p>
          </div>
          <div className="max-w-full text-left sm:text-right">
            <div className="num break-words text-2xl font-bold text-brand-700 sm:text-3xl">{ugx(app.amount)}</div>
            <div className="caps mt-1">Requested</div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-6 border-t border-rule pt-5 sm:grid-cols-4">
          <InfoRow k="Term" v={app.tenorMonths + " months"} />
          <InfoRow k="Take-home" v={profile ? ugx(profile.netSalary) : "-"} />
          <InfoRow k="Gross salary" v={profile ? ugx(profile.grossSalary) : "-"} />
          <InfoRow k="Current stage" v={routing.currentStage ? label(routing.currentStage.approverRole) : label(routing.state)} />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Left column */}
        <div className="min-w-0 space-y-5 lg:col-span-2">
          {/* Applicant Information */}
          <div className="rounded-xl border border-rule bg-surface p-5 shadow-theme-sm">
            <div className="mb-4 flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-brand-50 text-brand-700"><User className="h-3.5 w-3.5" /></span>
              <span className="caps">Applicant information</span>
            </div>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
              <InfoRow k="Employee no" v={meta.employee_no as string} />
              <InfoRow k="Department" v={(meta.department as string) ?? "-"} />
              <InfoRow k="Title" v={(meta.title as string) ?? "-"} />
              <InfoRow k="Probation" v={profile ? (profile.isPostProbation ? "Passed" : "On probation") : "-"} />
              <InfoRow k="Final warning" v={profile ? (profile.onFinalWarning ? "Yes" : "None") : "-"} />
              <InfoRow k="External loans" v={externalDeclared ? "Declared" : "None declared"} />
            </div>
          </div>

          {/* Loan Details */}
          <div className="rounded-xl border border-rule bg-surface p-5 shadow-theme-sm">
            <div className="mb-4 flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-brand-50 text-brand-700"><FileText className="h-3.5 w-3.5" /></span>
              <span className="caps">Loan details</span>
            </div>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
              <InfoRow k="Product" v={meta.product_name as string} />
              <InfoRow k="Type" v={label(meta.product_kind as string)} />
              <InfoRow k="Purpose" v={cleanPurpose || "-"} />
              <InfoRow k="Requested" v={ugx(app.amount)} />
              <InfoRow k="Term" v={app.tenorMonths + " months"} />
              <InfoRow k="Interest rate" v={quotedRate} />
            </div>
          </div>

          {/* Repayment schedule (approved loans) */}
          {schedule.length > 0 ? (
            <ScheduleTable
              schedule={schedule}
              // annual_rate is stored as a fraction (0.16 = 16%); ScheduleTable
              // wants a percent for display (16), not a fraction of a fraction.
              annualRate={loan ? Number(loan.annual_rate) * 100 : null}
              currency={currency}
            />
          ) : null}

          {/* Decisions history */}
          {decisions.length > 0 ? (
            <div className="overflow-x-auto rounded-2xl border border-rule bg-surface shadow-theme-xs">
              <div className="caps px-5 pt-4">Decisions</div>
              <table className="ledger mt-2">
                <tbody>
                  {decisions.map((d, i) => (
                    <tr key={i}>
                      <td style={{ width: "7rem" }}>
                        <span className={d.decision === "rejected" ? "chip chip--rejected" : "chip chip--approved"}>
                          {label(d.decision as string)}
                        </span>
                      </td>
                      <td>
                        <div className="text-sm font-medium text-ink">{d.approver_name}</div>
                        <div className="text-xs text-ink-soft">
                          {(d.approver_title as string | null) || label((d.approver_role as string | null) ?? "")}
                        </div>
                        {d.comment ? <div className="mt-0.5 text-xs text-ink-soft">{d.comment}</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {/* Right rail */}
        <div className="min-w-0 space-y-5">
          {profile && rules ? (
            <UnderwritingChecklist
              profile={profile}
              rules={rules}
              amount={app.amount}
              tenorMonths={app.tenorMonths}
              externalDeclared={externalDeclared}
              currency={currency}
            />
          ) : null}

          <StatusTimeline
            stages={routing.stages}
            completedIds={doneIds}
            currentId={routing.currentStage?.id ?? null}
            rejectedId={rejected ? routing.rejectedAt?.id ?? null : null}
          />

          {isMyTurn && routing.currentStage ? (
            <div className="rounded-xl border border-rule bg-surface p-5 shadow-theme-sm">
              <div className="caps mb-3">Your decision</div>
              {error ? (
                <div className="mb-3 rounded-md bg-rejected-wash px-3 py-2 text-sm text-rejected">{error}</div>
              ) : null}
              <form action={decideAction} className="space-y-3">
                <input type="hidden" name="applicationId" value={app.applicationId} />
                <textarea
                  name="comment"
                  rows={3}
                  placeholder="Comment (required to reject)"
                  className="w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
                <div>
                  <label className="text-xs text-ink-soft" htmlFor="startDate">
                    Disbursement start date (required if this is the final approval)
                  </label>
                  <input
                    id="startDate"
                    type="date"
                    name="startDate"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    className="mt-1 w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  />
                </div>
                <div className="flex gap-2">
                  <button type="submit" name="decision" value="approved" className="btn btn--primary flex-1">
                    Approve
                  </button>
                  <button type="submit" name="decision" value="rejected" className="btn btn--danger flex-1">
                    Reject
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {!isMyTurn && routing.state === "pending" && routing.currentStage ? (
            <div className="rounded-xl border border-rule bg-surface p-4 shadow-theme-sm text-sm text-ink-soft">
              Currently with {label(routing.currentStage.approverRole)}.
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
