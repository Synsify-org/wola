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
import DashboardCFO from "@/components/dashboard-cfo";
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
    };

    const mine = await employeeMetrics(tx, ctx.userId);

    if (!ctx.canSeeAllLoans) {
      return { user, mine, book: null, inbox: [], mix: [], pipeline: [], recent: [] };
    }

    const inbox = await inboxFor(tx, ctx.tenantId, {
      userId: ctx.userId,
      employeeId: (me?.id as string) ?? null,
      role: ctx.role,
    });
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

    return { user, mine, book, inbox, mix, pipeline, recent };
  });

  const { user, mine, book, inbox, mix, pipeline, recent } = data;

  return (
    <Shell user={user} tenantName={(tenant?.name as string) ?? "Wola"}>
      {book ? (
        <DashboardCFO
          book={book}
          inbox={inbox as never[]}
          mix={mix as never[]}
          pipeline={pipeline}
          recent={recent}
        />
      ) : (
        <DashboardEmployee mine={mine} />
      )}
    </Shell>
  );
}
