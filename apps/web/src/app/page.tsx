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
  employeeMetrics,
  approverMetrics,
  loansByProduct,
  inboxFor,
} from "@wola/db";
import { db } from "@/lib/tenant";
import Shell from "@/components/shell";
import DashboardCFO, { type InboxItem, type MixRow } from "@/components/dashboard-cfo";
import DashboardEmployee from "@/components/dashboard-employee";

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

    const mine = await employeeMetrics(tx, ctx.userId);

    // Employees see only their personal dashboard.
    if (ctx.scope === "own") {
      return { user, mine, book: null, inbox: [], mix: [], pipeline: [], recent: [], exposureTrend: [] };
    }

    // Approver worklist. For a dept head this is already limited by the
    // approval engine (canAct) to applications at their stage.
    const inbox = await inboxFor(tx, ctx.tenantId, {
      userId: ctx.userId,
      employeeId: (me?.id as string) ?? null,
      role: ctx.role,
    });

    // DEPARTMENT scope: a dept head sees the CFO-shaped dashboard, but every
    // figure is limited to employees who report to them (scopeEmployeeIds).
    // We reuse dashboard-cfo but feed it department-filtered book/mix/recent.
    if (ctx.scope === "department") {
      const ids = ctx.scopeEmployeeIds;
      // Fail closed: no reports => empty book, not the whole company.
      const scoped = ids.length > 0;

      const [bookRow] = scoped
        ? await tx`
            SELECT count(*)::int AS active_loans,
                   COALESCE(sum(l.principal), 0) AS principal
            FROM loans l
            JOIN loan_applications la ON la.id = l.application_id
            WHERE l.status = 'active' AND la.employee_id = ANY(${ids})`
        : [{ active_loans: 0, principal: 0 }];

      const [expRow] = scoped
        ? await tx`
            SELECT COALESCE(sum(
              COALESCE((SELECT sl.closing_balance FROM schedule_lines sl
                        JOIN loan_schedules s ON s.id = sl.schedule_id
                        WHERE s.loan_id = l.id AND s.is_active
                          AND sl.due_date <= CURRENT_DATE
                        ORDER BY sl.period_no DESC LIMIT 1), l.principal)
            ), 0) AS outstanding
            FROM loans l
            JOIN loan_applications la ON la.id = l.application_id
            WHERE l.status = 'active' AND la.employee_id = ANY(${ids})`
        : [{ outstanding: 0 }];

      const [flightRow] = scoped
        ? await tx`
            SELECT count(*)::int AS n FROM loan_applications
            WHERE status IN ('submitted','in_review') AND employee_id = ANY(${ids})`
        : [{ n: 0 }];
      const [rejRow] = scoped
        ? await tx`
            SELECT count(*)::int AS n FROM loan_applications
            WHERE status = 'rejected'
              AND created_at >= date_trunc('year', CURRENT_DATE)
              AND employee_id = ANY(${ids})`
        : [{ n: 0 }];

      const book = {
        kind: "approver" as const,
        totalExposure: Number(expRow?.outstanding ?? 0),
        activeLoans: Number(bookRow?.active_loans ?? 0),
        principalDisbursed: Number(bookRow?.principal ?? 0),
        awaitingMe: inbox.length,
        interestBook: 0, // department heads don't see interest projections
        applicationsInFlight: Number(flightRow?.n ?? 0),
        rejectedThisYear: Number(rejRow?.n ?? 0),
      };

      const mix = scoped
        ? await tx`
            SELECT lp.name, lp.kind, count(*)::int AS n,
                   COALESCE(sum(l.principal), 0) AS principal
            FROM loans l
            JOIN loan_applications la ON la.id = l.application_id
            JOIN loan_products lp ON lp.id = la.loan_product_id
            WHERE l.status = 'active' AND la.employee_id = ANY(${ids})
            GROUP BY lp.name, lp.kind ORDER BY principal DESC`
        : [];

      const pipelineRows = scoped
        ? await tx`
            SELECT la.status, count(*)::int AS n
            FROM loan_applications la
            WHERE la.employee_id = ANY(${ids})
            GROUP BY la.status`
        : [];
      const pipeline = pipelineRows.map((r) => ({ status: r.status as string, n: Number(r.n) }));

      const recentRows = scoped
        ? await tx`
            SELECT l.id, e.full_name, lp.name AS product, l.principal, l.start_date
            FROM loans l
            JOIN loan_applications la ON la.id = l.application_id
            JOIN employees e ON e.id = la.employee_id
            JOIN loan_products lp ON lp.id = la.loan_product_id
            WHERE l.status = 'active' AND la.employee_id = ANY(${ids})
            ORDER BY l.start_date DESC LIMIT 5`
        : [];
      const recent = recentRows.map((r) => ({
        id: r.id as string,
        borrower: r.full_name as string,
        product: r.product as string,
        principal: Number(r.principal),
        date: r.start_date ? new Date(r.start_date as string).toISOString() : null,
      }));

      return { user, mine, book, inbox, mix, pipeline, recent, exposureTrend: [] };
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

    return { user, mine, book, inbox, mix, pipeline, recent, exposureTrend };
  });

  const { user, mine, book, inbox, mix, pipeline, recent, exposureTrend } = data;

  return (
    <Shell user={user} tenantName={(tenant?.name as string) ?? "Wola"}>
      {book ? (
        <DashboardCFO
          book={book}
          inbox={inbox as unknown as InboxItem[]}
          mix={mix as unknown as MixRow[]}
          pipeline={pipeline}
          recent={recent}
          exposureTrend={exposureTrend ?? []}
        />
      ) : (
        <DashboardEmployee mine={mine} />
      )}
    </Shell>
  );
}
