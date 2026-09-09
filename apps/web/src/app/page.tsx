// apps/web/src/app/page.tsx - the dashboard.
// Thin: fetch role-aware data, then render the matching dashboard component.
// An approver sees the book + worklist; an employee sees their own position.
//
// NOTE: the pipeline + recent queries below are inline stopgaps. TODO: move to
// @wola/db (Willy) as applicationPipeline() and recentApprovedLoans().
import { headers } from "next/headers";
import { requireSession } from "@/lib/guard";
import {
  resolveTenant,
  employeePosition,
  approverMetrics,
  loansByProduct,
  inboxFor,
  disbursementQueue,
  reconciliationThisCycle,
  registerHealth,
  configurationStatus,
} from "@wola/db";
import { db } from "@/lib/tenant";
import Shell from "@/components/shell";
import DashboardCFO, { type InboxItem, type MixRow } from "@/components/dashboard-cfo";
import DashboardHR from "@/components/dashboard-hr";
import DashboardCEO, { type CEOInboxItem } from "@/components/dashboard-ceo"; // dashboard-ceo also exports MixRow, structurally identical to dashboard-cfo's — reuse the one already imported below rather than a colliding second import
import DashboardCOO, { type COOInboxItem } from "@/components/dashboard-coo";
import DashboardAdmin from "@/components/dashboard-admin";
import DashboardAuditor, { type AuditRow } from "@/components/dashboard-auditor";
import DashboardDeptHead, { type QueueItem } from "@/components/dashboard-depthead";
import DashboardEmployee from "@/components/dashboard-employee";

// Money-operations console (§6.2's CFO hero) is scoped to the roles that can
// actually disburse — must match DISBURSER_ROLES in loans/[id]/actions.ts.
// Every other full-book role now has its own dashboard below (HR, CEO, COO/
// group_ceo, admin/org_admin, auditor) — DashboardCFO is CFO-only in practice
// now, this list stays as the action-permission source of truth it mirrors.
const DISBURSER_ROLES = ["cfo", "ceo", "md", "coo", "group_ceo", "admin", "org_admin"];

// "COO / other executive approvers" (doc §6.2): oversight-level roles that
// sit in a pipeline stage but aren't CFO/CEO/HR. coo and group_ceo are the
// real enum values a pipeline stage resolves to (see MUA's own CEO-applying
// pipeline: hr -> cfo -> coo -> group_ceo). Not org_admin/auditor — those are
// 1.7/1.8, a different kind of role entirely (config/read-only, not approval).
const EXEC_APPROVER_ROLES = ["coo", "group_ceo"];

// Administration capability (doc §6.2): configuration/readiness, not a
// lending role. 'admin' kept alongside 'org_admin' — see guard.ts's note on
// the two spellings.
const ADMIN_ROLES = ["org_admin", "admin"];

export default async function Dashboard() {
  const slug = (await headers()).get("x-tenant-slug") ?? "";
  const tenant = slug ? await resolveTenant(db, slug) : null;

  const data = await requireSession(async (tx, ctx) => {
    const [me] = await tx`
      SELECT e.id, e.full_name, u.email
      FROM users u
      LEFT JOIN employees e ON e.user_id = u.id
      WHERE u.id = ${ctx.userId}`;

    const user = {
      name: (me?.full_name as string) ?? (me?.email as string) ?? "User",
      email: (me?.email as string) ?? "",
      role: ctx.role,
      canSeeAllLoans: ctx.canSeeAllLoans,
      canApprove: ctx.canApprove,
    };

    // Employees see only their personal dashboard. Fetched only here — it's
    // the heaviest of these queries (per-application routing + a full
    // eligibility pass) and every other branch below renders a component
    // that never reads `mine`.
    if (ctx.scope === "own") {
      const mine = await employeePosition(tx, ctx.userId);
      return {
        user, mine, book: null, inbox: [], mix: [], pipeline: [], recent: [], exposureTrend: [],
        canDisburse: false, queue: [], reconciliation: null, health: null, ceoView: null, configStatus: null, auditRows: null,
        deptQueue: null, teamActiveLoans: 0, myOutstanding: null,
      };
    }

    // Approver worklist. For a dept head this is already limited by the
    // approval engine (canAct) to applications at their stage.
    const inbox = await inboxFor(tx, ctx.tenantId, {
      userId: ctx.userId,
      employeeId: (me?.id as string) ?? null,
      role: ctx.role,
    });

    // DEPARTMENT scope: the dept-head hero is the approval queue itself (see
    // dashboard-depthead.tsx) — inboxFor() above is ALREADY scoped by canAct
    // to this head's own reports, so it doubles directly as the worklist,
    // no separate query needed. No book/exposure/mix here at all — a dept
    // head must not see a financial book, even a department-scoped one.
    if (ctx.scope === "department") {
      const ids = ctx.scopeEmployeeIds;
      const scoped = ids.length > 0;

      const [teamRow] = scoped
        ? await tx`
            SELECT count(*)::int AS n FROM loans l
            JOIN loan_applications la ON la.id = l.application_id
            WHERE l.status = 'active' AND la.employee_id = ANY(${ids})`
        : [{ n: 0 }];

      const myPosition = await employeePosition(tx, ctx.userId);
      const myOutstanding = myPosition && myPosition.loans.length > 0
        ? myPosition.loans.reduce((s, l) => s + l.outstanding, 0)
        : null;

      return {
        user, mine: null, book: null, inbox: [], mix: [], pipeline: [], recent: [], exposureTrend: [],
        canDisburse: false, queue: [], reconciliation: null, health: null, ceoView: null, configStatus: null, auditRows: null,
        deptQueue: inbox, teamActiveLoans: Number(teamRow?.n ?? 0), myOutstanding,
      };
    }

    // From here: full-book roles (scope === "all").
    const book = await approverMetrics(tx, inbox.length);
    const mix = await loansByProduct(tx);

    // Pipeline: application counts by status (real).
    const pipelineRows = await tx`
      SELECT status, count(*)::int AS n
      FROM loan_applications
      GROUP BY status`;
    const pipeline = pipelineRows.map((r) => ({
      status: r.status as string,
      n: Number(r.n),
    }));

    // Recent activity: last approved loans with borrower + product + date.
    const recentRows = await tx`
      SELECT l.id, e.full_name, lp.name AS product, l.principal, l.start_date
      FROM loans l
      JOIN loan_applications la ON la.id = l.application_id
      JOIN employees e ON e.id = la.employee_id
      JOIN loan_products lp ON lp.id = la.loan_product_id
      WHERE l.status = 'active'
      ORDER BY l.start_date DESC
      LIMIT 5`;
    const recent = recentRows.map((r) => ({
      id: r.id as string,
      borrower: r.full_name as string,
      product: r.product as string,
      principal: Number(r.principal),
      date: r.start_date ? new Date(r.start_date as string).toISOString() : null,
    }));

      // Sparkline: cumulative principal disbursed by month (real book growth).
    const growthRows = await tx`
      SELECT date_trunc('month', l.start_date) AS m, sum(l.principal) AS p
      FROM loans l
      WHERE l.status = 'active' AND l.start_date IS NOT NULL
      GROUP BY 1 ORDER BY 1`;
    let cum = 0;
    const exposureTrend = growthRows.map((r) => {
      cum += Number(r.p);
      return cum;
    });

    // Money-operations console — only for roles that can actually disburse
    // AND still land on the shared DashboardCFO (CEO and the exec-approver
    // roles have their own dashboards below and must never see this — see
    // dashboard-ceo.tsx / dashboard-coo.tsx). Fetched here, not unconditionally,
    // so roles that never render it don't pay the cost.
    const showsMoneyOps =
      DISBURSER_ROLES.includes(ctx.role) &&
      ctx.role !== "ceo" &&
      !EXEC_APPROVER_ROLES.includes(ctx.role) &&
      !ADMIN_ROLES.includes(ctx.role);
    const queue = showsMoneyOps ? await disbursementQueue(tx, ctx.tenantId) : [];
    const reconciliation = showsMoneyOps ? await reconciliationThisCycle(tx, ctx.tenantId) : null;

    // HR gets its own hero (register data quality, not the financial book —
    // see dashboard-hr.tsx). Only fetched for HR.
    const health = ctx.role === "hr" ? await registerHealth(tx, ctx.tenantId) : null;

    // CEO gets its own hero (programme health + trend, no disbursement, no
    // reconciliation, no employee register — doc's explicit "must not show"
    // list). "Settled" isn't tracked in approverMetrics(); one small count here.
    let ceoView: { settled: number } | null = null;
    if (ctx.role === "ceo") {
      const [settledRow] = await tx`SELECT count(*)::int AS n FROM loans WHERE status = 'settled'`;
      ceoView = { settled: Number(settledRow?.n ?? 0) };
    }

    // Admin gets the readiness-checklist hero (config, not lending — see
    // dashboard-admin.tsx). Only fetched for org_admin/admin.
    const configStatus = ADMIN_ROLES.includes(ctx.role)
      ? await configurationStatus(tx, ctx.tenantId)
      : null;

    // Auditor gets the read-only activity hero — no action control anywhere
    // (see dashboard-auditor.tsx). Same query shape as /audit-log, capped
    // tighter since this is a dashboard snippet, not the full log.
    const auditRows = ctx.role === "auditor"
      ? ((await tx`
          SELECT a.id, a.action, a.entity, a.entity_id, a.at, u.email AS actor_email
          FROM audit_log a
          LEFT JOIN users u ON u.id = a.actor_id
          ORDER BY a.at DESC
          LIMIT 20`) as unknown as { id: string; action: string; entity: string; entity_id: string | null; at: string; actor_email: string | null }[])
      : null;

    return {
      user, mine: null, book, inbox, mix, pipeline, recent, exposureTrend,
      canDisburse: showsMoneyOps, queue, reconciliation, health, ceoView, configStatus, auditRows,
      deptQueue: null, teamActiveLoans: 0, myOutstanding: null,
    };
  });

  const {
    user, mine, book, inbox, mix, pipeline, recent, exposureTrend, canDisburse, queue, reconciliation, health, ceoView,
    configStatus, auditRows, deptQueue, teamActiveLoans, myOutstanding,
  } = data;

  return (
    <Shell user={user} tenantName={(tenant?.name as string) ?? "Wola"}>
      {deptQueue ? (
        <DashboardDeptHead
          queue={deptQueue as unknown as QueueItem[]}
          teamActiveLoans={teamActiveLoans}
          myOutstanding={myOutstanding}
        />
      ) : health ? (
        <DashboardHR
          health={health}
          inbox={inbox as unknown as InboxItem[]}
          pipeline={pipeline}
        />
      ) : ceoView && book ? (
        <DashboardCEO
          totalExposure={book.totalExposure}
          valueUnderManagement={book.principalDisbursed}
          exposureTrend={exposureTrend ?? []}
          inProgress={book.applicationsInFlight}
          settled={ceoView.settled}
          rejectedThisYear={book.rejectedThisYear}
          inbox={inbox as unknown as CEOInboxItem[]}
          mix={mix as unknown as MixRow[]}
        />
      ) : configStatus ? (
        <DashboardAdmin status={configStatus} />
      ) : auditRows ? (
        <DashboardAuditor
          rows={auditRows.map((r) => ({
            id: r.id,
            action: r.action,
            entity: r.entity,
            entityId: r.entity_id,
            actorEmail: r.actor_email,
            at: r.at,
          }))}
        />
      ) : book && EXEC_APPROVER_ROLES.includes(user.role) ? (
        <DashboardCOO
          inbox={inbox as unknown as COOInboxItem[]}
          totalExposure={book.totalExposure}
          activeLoans={book.activeLoans}
          principalDisbursed={book.principalDisbursed}
          interestBook={book.interestBook}
        />
      ) : book ? (
        <DashboardCFO
          book={book}
          inbox={inbox as unknown as InboxItem[]}
          mix={mix as unknown as MixRow[]}
          pipeline={pipeline}
          recent={recent}
          exposureTrend={exposureTrend ?? []}
          canDisburse={canDisburse}
          queue={queue}
          reconciliation={reconciliation}
        />
      ) : (
        <DashboardEmployee mine={mine} />
      )}
    </Shell>
  );
}
