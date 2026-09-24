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
  collectionsTrend,
  type CollectionsPoint,
} from "@wola/db";
import { db } from "@/lib/tenant";
import DashboardCFO, { type InboxItem, type MixRow } from "@/components/dashboard-cfo";
import DashboardHR from "@/components/dashboard-hr";
import DashboardCEO, { type CEOInboxItem } from "@/components/dashboard-ceo"; // dashboard-ceo also exports MixRow, structurally identical to dashboard-cfo's — reuse the one already imported below rather than a colliding second import
import DashboardCOO, { type COOInboxItem } from "@/components/dashboard-coo";
import DashboardAdmin from "@/components/dashboard-admin";
import DashboardAuditor, { type AuditRow } from "@/components/dashboard-auditor";
import DashboardDeptHead, { type QueueItem } from "@/components/dashboard-depthead";
import DashboardEmployee from "@/components/dashboard-employee";
import DashboardWelcomeBanner, { type BannerHighlight, type HeaderAction } from "@/components/dashboard-welcome-banner";
import { formatMoney } from "@wola/engine";
import { CheckSquare, FileBarChart, FilePlus, ScrollText, Settings, Users, Wallet } from "lucide-react";

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

    // Just the name — role/canSeeAllLoans/etc already live on ctx; the rest
    // of the old `user` object (email, canApprove) was only ever used by
    // Shell, which now gets its own copy of this in (app)/layout.tsx.
    const displayName = (me?.full_name as string) ?? (me?.email as string) ?? "User";

    // Employees see only their personal dashboard. Fetched only here — it's
    // the heaviest of these queries (per-application routing + a full
    // eligibility pass) and every other branch below renders a component
    // that never reads `mine`.
    if (ctx.scope === "own") {
      const mine = await employeePosition(tx, ctx.userId);
      return {
        displayName, role: ctx.role, mine, book: null, inbox: [], mix: [], pipeline: [], recent: [], exposureTrend: [],
        canDisburse: false, queue: [], reconciliation: null, health: null, ceoView: null, configStatus: null, auditRows: null,
        deptQueue: null, teamActiveLoans: 0, myOutstanding: null, collections: [] as CollectionsPoint[],
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
        displayName, role: ctx.role, mine: null, book: null, inbox: [], mix: [], pipeline: [], recent: [], exposureTrend: [],
        canDisburse: false, queue: [], reconciliation: null, health: null, ceoView: null, configStatus: null, auditRows: null,
        deptQueue: inbox, teamActiveLoans: Number(teamRow?.n ?? 0), myOutstanding, collections: [] as CollectionsPoint[],
      };
    }

    // From here: full-book roles (scope === "all"). None of these depend on
    // each other's results (book only needs inbox.length, already known) —
    // batching them into one Promise.all lets postgres.js pipeline the
    // requests on the wire instead of paying a full network round trip per
    // query, one after another. On a database in a different region than
    // the app (the common case on a free-tier deploy), that sequential
    // chain — 8+ round trips end to end — was the confirmed live cause of
    // multi-second dashboard loads (7-8s per load, measured).
    const showsMoneyOps =
      DISBURSER_ROLES.includes(ctx.role) &&
      ctx.role !== "ceo" &&
      !EXEC_APPROVER_ROLES.includes(ctx.role) &&
      !ADMIN_ROLES.includes(ctx.role);

    // Which dashboards plot collections: the CFO-style book view and the CEO.
    const showsCollections =
      ctx.role !== "hr" && ctx.role !== "auditor" &&
      !ADMIN_ROLES.includes(ctx.role) && !EXEC_APPROVER_ROLES.includes(ctx.role);

    const [
      book, mix, pipelineRows, recentRows, growthRows,
      queue, reconciliation, health, settledRows, configStatus, auditRowsRaw, collections,
    ] = await Promise.all([
      approverMetrics(tx, inbox.length),
      loansByProduct(tx),
      tx`SELECT status, count(*)::int AS n FROM loan_applications GROUP BY status`,
      tx`
        SELECT l.id, e.full_name, lp.name AS product, l.principal, l.start_date
        FROM loans l
        JOIN loan_applications la ON la.id = l.application_id
        JOIN employees e ON e.id = la.employee_id
        JOIN loan_products lp ON lp.id = la.loan_product_id
        WHERE l.status = 'active'
        ORDER BY l.start_date DESC
        LIMIT 5`,
      // Sparkline: cumulative principal disbursed by month (real book growth).
      tx`
        SELECT date_trunc('month', l.start_date) AS m, sum(l.principal) AS p
        FROM loans l
        WHERE l.status = 'active' AND l.start_date IS NOT NULL
        GROUP BY 1 ORDER BY 1`,
      // Money-operations console — only for roles that can actually disburse
      // AND still land on the shared DashboardCFO (CEO and the exec-approver
      // roles have their own dashboards below and must never see this — see
      // dashboard-ceo.tsx / dashboard-coo.tsx).
      showsMoneyOps ? disbursementQueue(tx, ctx.tenantId) : Promise.resolve([]),
      showsMoneyOps ? reconciliationThisCycle(tx, ctx.tenantId) : Promise.resolve(null),
      // HR gets its own hero (register data quality, not the financial book).
      ctx.role === "hr" ? registerHealth(tx, ctx.tenantId) : Promise.resolve(null),
      // CEO's hero needs "settled", which approverMetrics() doesn't track.
      ctx.role === "ceo"
        ? tx`SELECT count(*)::int AS n FROM loans WHERE status = 'settled'`
        : Promise.resolve(null),
      // Admin gets the readiness-checklist hero (config, not lending).
      ADMIN_ROLES.includes(ctx.role) ? configurationStatus(tx, ctx.tenantId) : Promise.resolve(null),
      // Auditor gets the read-only activity hero — same query shape as
      // /audit-log, capped tighter since this is a dashboard snippet.
      ctx.role === "auditor"
        ? tx`
            SELECT a.id, a.action, a.entity, a.entity_id, a.at, u.email AS actor_email
            FROM audit_log a
            LEFT JOIN users u ON u.id = a.actor_id
            ORDER BY a.at DESC
            LIMIT 20`
        : Promise.resolve(null),
      // Collected vs Expected chart — the CFO and CEO dashboards only.
      showsCollections ? collectionsTrend(tx, 6) : Promise.resolve([] as CollectionsPoint[]),
    ]);

    const pipeline = pipelineRows.map((r) => ({
      status: r.status as string,
      n: Number(r.n),
    }));

    const recent = recentRows.map((r) => ({
      id: r.id as string,
      borrower: r.full_name as string,
      product: r.product as string,
      principal: Number(r.principal),
      date: r.start_date ? new Date(r.start_date as string).toISOString() : null,
    }));

    let cum = 0;
    const exposureTrend = growthRows.map((r) => {
      cum += Number(r.p);
      return cum;
    });

    const ceoView: { settled: number } | null = ctx.role === "ceo"
      ? { settled: Number((settledRows as unknown as { n: number }[] | null)?.[0]?.n ?? 0) }
      : null;

    const auditRows = auditRowsRaw as unknown as
      { id: string; action: string; entity: string; entity_id: string | null; at: string; actor_email: string | null }[] | null;

    return {
      displayName, role: ctx.role, mine: null, book, inbox, mix, pipeline, recent, exposureTrend,
      canDisburse: showsMoneyOps, queue, reconciliation, health, ceoView, configStatus, auditRows, collections,
      deptQueue: null, teamActiveLoans: 0, myOutstanding: null,
    };
  });

  const {
    displayName, role, mine, book, inbox, mix, pipeline, recent, exposureTrend, canDisburse, queue, reconciliation, health, ceoView,
    configStatus, auditRows, deptQueue, teamActiveLoans, myOutstanding, collections,
  } = data;

  // Same "one question" per role as before, now spoken once by the banner
  // instead of duplicated as a header on all 8 dashboards individually.
  const subtitle = deptQueue
    ? "Who on my team needs my decision right now?"
    : health
      ? "Is my people-data healthy, and what is waiting at my stage?"
      : ceoView && book
        ? "Is the loan programme healthy?"
        : configStatus
          ? "Is this tenant configured correctly and running?"
          : auditRows
            ? "Show me everything; let me change nothing."
            : book && EXEC_APPROVER_ROLES.includes(role)
              ? "What is waiting at my stage?"
              : book
                ? "Where is the money — going out, coming back, and at risk?"
                : "Where do I stand, and what comes out of my next payslip?";

  const tenantDisplayName = (tenant?.name as string) ?? "Wola";
  const currency = (tenant?.currency as string) ?? "UGX";

  // Header actions: each role's most frequent next step, primary last. Every
  // href is a page the role can already reach (same gates as nav-links.tsx).
  const approvals: HeaderAction = { href: "/approvals", label: "Approvals", icon: CheckSquare, primary: true };
  const reports: HeaderAction = { href: "/reports", label: "Reports", icon: FileBarChart };
  const apply: HeaderAction = { href: "/apply", label: "Apply for a loan", icon: FilePlus, primary: true };
  const actions: HeaderAction[] = deptQueue
    ? [{ href: "/loans?mine=1", label: "My loans", icon: Wallet }, apply]
    : health
      ? [{ href: "/settings/employees", label: "Employees", icon: Users }, approvals]
      : configStatus
        ? [{ href: "/settings", label: "Settings", icon: Settings, primary: true }]
        : auditRows
          ? [reports, { href: "/audit-log", label: "Audit log", icon: ScrollText, primary: true }]
          : book
            ? [reports, approvals]
            : [{ href: "/loans", label: "My loans", icon: Wallet }, apply];

  // Banner highlight: ONE live figure per role — what needs this person now.
  // Built only from data already loaded above; no extra queries.
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const waiting = (n: number, what: string): BannerHighlight =>
    n > 0
      ? { label: `${plural(n, "application", "applications")} ${what}`, href: "/approvals", tone: "attention" }
      : { label: "Nothing is waiting on you", tone: "calm" };
  const nextDeduction = mine?.loans
    .filter((l) => l.nextDueDate)
    .sort((a, b) => String(a.nextDueDate).localeCompare(String(b.nextDueDate)))[0];
  const bestLimit = Math.max(0, ...(mine?.eligibility ?? []).map((e) => e.maxAmount));
  const configured =
    configStatus &&
    configStatus.productsCount > 0 &&
    configStatus.productsWithoutPipeline.length === 0 &&
    configStatus.productsMissingRateIndex.length === 0;
  const exceptions = reconciliation?.exceptions.length ?? 0;

  const highlight: BannerHighlight | undefined = deptQueue
    ? waiting(deptQueue.length, "from your team need your decision")
    : health
      ? waiting(inbox.length, "waiting at the HR stage")
      : configStatus
        ? configured
          ? { label: "Tenant is fully configured and ready to lend", tone: "calm" }
          : { label: "Setup is incomplete. Finish the checklist to start lending", href: "/settings", tone: "attention" }
        : auditRows
          ? { label: "Read-only access. Nothing here can be changed", tone: "calm" }
          : book
            ? book.awaitingMe > 0
              ? waiting(book.awaitingMe, "awaiting your decision")
              : exceptions > 0
                ? { label: `${plural(exceptions, "payroll exception", "payroll exceptions")} this cycle`, tone: "attention" }
                : waiting(0, "")
            : nextDeduction
              ? {
                  label: `Next deduction ${formatMoney(nextDeduction.monthlyDeduction, currency)} on ${new Date(
                    String(nextDeduction.nextDueDate),
                  ).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
                  href: `/loans/${nextDeduction.loanId}`,
                  tone: "calm",
                }
              : (mine?.applicationsInFlight.length ?? 0) > 0
                ? { label: `${plural(mine!.applicationsInFlight.length, "application", "applications")} in review`, href: "/loans", tone: "calm" }
                : bestLimit > 0
                  ? { label: `You can borrow up to ${formatMoney(bestLimit, currency)}`, href: "/apply", tone: "calm" }
                  : undefined;

  return (
    <>
      <DashboardWelcomeBanner name={displayName} tenantName={tenantDisplayName} subtitle={subtitle} actions={actions} highlight={highlight} />
      {deptQueue ? (
        <DashboardDeptHead
          queue={deptQueue as unknown as QueueItem[]}
          teamActiveLoans={teamActiveLoans}
          myOutstanding={myOutstanding}
          currency={currency}
        />
      ) : health ? (
        <DashboardHR
          health={health}
          inbox={inbox as unknown as InboxItem[]}
          pipeline={pipeline}
          currency={currency}
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
          collections={collections}
          currency={currency}
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
      ) : book && EXEC_APPROVER_ROLES.includes(role) ? (
        <DashboardCOO
          inbox={inbox as unknown as COOInboxItem[]}
          totalExposure={book.totalExposure}
          activeLoans={book.activeLoans}
          principalDisbursed={book.principalDisbursed}
          interestBook={book.interestBook}
          currency={currency}
        />
      ) : book ? (
        <DashboardCFO
          book={book}
          inbox={inbox as unknown as InboxItem[]}
          mix={mix as unknown as MixRow[]}
          collections={collections}
          pipeline={pipeline}
          recent={recent}
          exposureTrend={exposureTrend ?? []}
          canDisburse={canDisburse}
          queue={queue}
          reconciliation={reconciliation}
          currency={currency}
        />
      ) : (
        <DashboardEmployee mine={mine} currency={currency} />
      )}
    </>
  );
}
