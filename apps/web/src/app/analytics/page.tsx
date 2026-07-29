// apps/web/src/app/analytics/page.tsx - management analytics.
// Admin-only. All aggregate queries here are inline stopgaps.
// TODO: move to @wola/db (Willy) as analytics.ts functions.
import { headers } from "next/headers";
import { requireSession } from "@/lib/guard";
import { resolveTenant, loansByProduct, approverMetrics, inboxFor } from "@wola/db";
import { db } from "@/lib/tenant";
import Shell from "@/components/shell";
import AnalyticsView from "@/components/analytics-view";

export default async function AnalyticsPage() {
  const slug = (await headers()).get("x-tenant-slug") ?? "";
  const tenant = slug ? await resolveTenant(db, slug) : null;

  const data = await requireSession(async (tx, ctx) => {
    const [me] = await tx`SELECT e.id, e.full_name, u.email FROM users u LEFT JOIN employees e ON e.user_id = u.id WHERE u.id = ${ctx.userId}`;
    const user = {
      name: (me?.full_name as string) ?? (me?.email as string) ?? "-",
      email: (me?.email as string) ?? "",
      role: ctx.role,
      canSeeAllLoans: ctx.canSeeAllLoans,
    };

    if (!ctx.canSeeAllLoans) {
      return { user, authorized: false as const };
    }

    const inbox = await inboxFor(tx, ctx.tenantId, { userId: ctx.userId, employeeId: (me?.id as string) ?? null, role: ctx.role });
    const book = await approverMetrics(tx, inbox.length);
    const mix = await loansByProduct(tx);

    // Application status counts (real).
    const statusRows = await tx`SELECT status, count(*)::int AS n FROM loan_applications GROUP BY status`;
    const statusCounts = statusRows.map((r) => ({ status: r.status as string, n: Number(r.n) }));
    const totalApps = statusCounts.reduce((s, r) => s + r.n, 0);
    const approvedApps = statusCounts.filter((r) => r.status === "approved").reduce((s, r) => s + r.n, 0);
    const approvalRate = totalApps > 0 ? Math.round((approvedApps / totalApps) * 100) : 0;

    // Applications by month (real, however sparse).
    const monthRows = await tx`
      SELECT to_char(date_trunc('month', created_at), 'Mon YY') AS label,
             date_trunc('month', created_at) AS m,
             count(*)::int AS total,
             count(*) FILTER (WHERE status = 'approved')::int AS approved
      FROM loan_applications
      GROUP BY 1, 2 ORDER BY 2`;
    const trend = monthRows.map((r) => ({
      label: r.label as string,
      total: Number(r.total),
      approved: Number(r.approved),
    }));

    // Book by department (real).
    const deptRows = await tx`
      SELECT COALESCE(e.department, 'Unassigned') AS department, count(*)::int AS n, sum(l.principal) AS principal
      FROM loans l
      JOIN loan_applications la ON la.id = l.application_id
      JOIN employees e ON e.id = la.employee_id
      WHERE l.status = 'active'
      GROUP BY 1 ORDER BY sum(l.principal) DESC`;
    const byDepartment = deptRows.map((r) => ({
      name: r.department as string,
      n: Number(r.n),
      principal: Number(r.principal),
    }));

    // Loan size bands (real).
    const bandRows = await tx`
      SELECT
        CASE
          WHEN principal < 1000000 THEN '< 1M'
          WHEN principal < 5000000 THEN '1M - 5M'
          WHEN principal < 20000000 THEN '5M - 20M'
          WHEN principal < 50000000 THEN '20M - 50M'
          ELSE '50M+'
        END AS band,
        CASE
          WHEN principal < 1000000 THEN 1
          WHEN principal < 5000000 THEN 2
          WHEN principal < 20000000 THEN 3
          WHEN principal < 50000000 THEN 4
          ELSE 5
        END AS ord,
        count(*)::int AS n
      FROM loans WHERE status = 'active'
      GROUP BY 1, 2 ORDER BY 2`;
    const sizeBands = bandRows.map((r) => ({ band: r.band as string, n: Number(r.n) }));

    // Product performance (real: apps, avg amount, approval rate).
    const perfRows = await tx`
      SELECT lp.name AS product,
             count(la.id)::int AS apps,
             avg(la.amount)::numeric AS avg_amount,
             count(la.id) FILTER (WHERE la.status = 'approved')::int AS approved
      FROM loan_products lp
      LEFT JOIN loan_applications la ON la.loan_product_id = lp.id
      GROUP BY lp.name ORDER BY count(la.id) DESC`;
    const productPerf = perfRows.map((r) => ({
      product: r.product as string,
      apps: Number(r.apps),
      avgAmount: Number(r.avg_amount ?? 0),
      approvalRate: Number(r.apps) > 0 ? Math.round((Number(r.approved) / Number(r.apps)) * 100) : 0,
    }));

    return {
      user,
      authorized: true as const,
      book,
      mix,
      statusCounts,
      totalApps,
      approvalRate,
      trend,
      byDepartment,
      sizeBands,
      productPerf,
    };
  });

  if (!data.authorized) {
    return (
      <Shell user={data.user} tenantName={(tenant?.name as string) ?? "Wola"}>
        <div className="rounded-xl border border-rule bg-surface p-8 text-center shadow-theme-sm">
          <p className="text-sm text-ink-soft">Analytics are available to management roles only.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell user={data.user} tenantName={(tenant?.name as string) ?? "Wola"}>
      <AnalyticsView
        book={data.book}
        mix={data.mix as never[]}
        statusCounts={data.statusCounts}
        totalApps={data.totalApps}
        approvalRate={data.approvalRate}
        trend={data.trend}
        byDepartment={data.byDepartment}
        sizeBands={data.sizeBands}
        productPerf={data.productPerf}
      />
    </Shell>
  );
}
