import { requireSession } from "@/lib/guard";
import { routeApplication, getEmployeeProfile, loadProductRules } from "@wola/db";
import { canAct } from "@wola/engine";
import { decideAction } from "./actions";
import UnderwritingChecklist from "@/components/underwriting-checklist";
import StatusTimeline from "@/components/status-timeline";
import ScheduleTable from "@/components/schedule-table";
import { User, FileText } from "lucide-react";
import Shell from "@/components/shell";
import { resolveTenant } from "@wola/db";
import { db } from "@/lib/tenant";
import { headers } from "next/headers";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();
const label = (r: string) => r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default async function ApplicationDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const slug = (await headers()).get("x-tenant-slug") ?? "";
  const tenant = slug ? await resolveTenant(db, slug) : null;

  const data = await requireSession(async (tx, ctx) => {
    const loaded = await routeApplication(tx, id);
    if (!loaded) return null;

    const [meWho] = await tx`SELECT e.id, e.full_name, u.email FROM users u LEFT JOIN employees e ON e.user_id = u.id WHERE u.id = ${ctx.userId}`;
    const user = {
      name: (meWho?.full_name as string) ?? (meWho?.email as string) ?? "User",
      email: (meWho?.email as string) ?? "",
      role: ctx.role,
      canSeeAllLoans: ctx.canSeeAllLoans,
    };

    const actor = { userId: ctx.userId, employeeId: (meWho?.id as string) ?? null, role: ctx.role };
    const applicant = {
      employeeId: loaded.app.employeeId,
      role: loaded.app.applicantRole,
      departmentHeadId: loaded.app.departmentHeadId,
    };
    const isMyTurn = loaded.routing.currentStage
      ? canAct(loaded.routing.currentStage, actor, applicant)
      : false;

    const [meta] = await tx`
      SELECT e.full_name, e.employee_no, e.department, e.title, e.user_id AS applicant_user_id,
             lp.name AS product_name, lp.kind AS product_kind,
             la.loan_product_id, la.declared_external_loans, la.purpose, la.created_at
      FROM loan_applications la
      JOIN employees e ON e.id = la.employee_id
      JOIN loan_products lp ON lp.id = la.loan_product_id
      WHERE la.id = ${id}`;

    const decisions = await tx`
      SELECT a.decision, a.comment, u.email AS approver
      FROM approvals a LEFT JOIN users u ON u.id = a.approver_user_id
      WHERE a.application_id = ${id} ORDER BY a.created_at`;

    const profile = meta.applicant_user_id ? await getEmployeeProfile(tx, meta.applicant_user_id as string) : null;
    const allRules = await loadProductRules(tx);
    const rules = allRules.find((r) => r.productId === meta.loan_product_id) ?? null;
    const externalDeclared =
      Array.isArray(meta.declared_external_loans) &&
      meta.declared_external_loans.length > 0;

    // Loan + amortization schedule (approved apps only). Inline stopgap - TODO @wola/db.
    const [loan] = await tx`
      SELECT id, principal, annual_rate, tenor_months, start_date
      FROM loans WHERE application_id = ${id} AND status = 'active' LIMIT 1`;
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

    return { ...loaded, user, isMyTurn, meta, decisions, profile, rules, externalDeclared, loan, schedule };
  });

  if (!data) {
    return (
      <div className="p-8">
        <h1 className="text-lg font-semibold text-ink">No such application</h1>
        <a href="/applications" className="text-sm text-brand hover:underline">Back to applications</a>
      </div>
    );
  }

  const { app, routing, isMyTurn, meta, decisions, profile, rules, externalDeclared, user, loan, schedule } = data;
  const doneIds = routing.completed.map((s) => s.id);
  const rejected = routing.state === "rejected";
  const statusChip =
    routing.state === "approved" ? "chip chip--approved"
    : rejected ? "chip chip--rejected"
    : "chip chip--awaiting";
  const cleanPurpose = meta.purpose
    ? (meta.purpose as string).replace(/^\[demo\][^a-z]*/i, "").trim()
    : "";
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
    <Shell user={user} tenantName={(tenant?.name as string) ?? "Wola"}>
      <nav className="mb-3 flex items-center gap-2 text-sm">
        <a href="/applications" className="font-medium text-ink-soft transition-colors hover:text-brand-700">Applications</a>
        <span className="text-ink-faint">/</span>
        <span className="font-medium text-ink">{meta.full_name}</span>
      </nav>

      {/* Rich header card */}
      <div className="mt-3 rounded-xl border border-rule bg-surface p-6 shadow-theme-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-ink">{meta.full_name}</h1>
              <span className={statusChip}>{label(routing.state)}</span>
            </div>
            <p className="mt-1 text-sm text-ink-soft">
              {meta.product_name}{cleanPurpose ? " \u00B7 " + cleanPurpose : ""}
            </p>
            <p className="mt-1 text-xs text-ink-faint">Applied {appliedDate}</p>
          </div>
          <div className="text-right">
            <div className="num text-3xl font-bold text-brand-700">{ugx(app.amount)}</div>
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

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-5 lg:col-span-2">
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
            </div>
          </div>

          {/* Repayment schedule (approved loans) */}
          {schedule.length > 0 ? (
            <ScheduleTable
              schedule={schedule}
              annualRate={loan ? Number(loan.annual_rate) / 100 : null}
            />
          ) : null}

          {/* Decisions history */}
          {decisions.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-rule bg-surface shadow-theme-sm">
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
                        <div className="text-sm text-ink">{d.approver}</div>
                        {d.comment ? <div className="text-xs text-ink-soft">{d.comment}</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {/* Right rail */}
        <div className="space-y-5">
          {profile && rules ? (
            <UnderwritingChecklist
              profile={profile}
              rules={rules}
              amount={app.amount}
              tenorMonths={app.tenorMonths}
              externalDeclared={externalDeclared}
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
    </Shell>
  );
}
