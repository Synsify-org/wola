// apps/web/src/app/reports/page.tsx - management reports (export-focused).
// Admin-only. Inline aggregate + detail queries are stopgaps. TODO: @wola/db.
import { headers } from "next/headers";
import { requireSession } from "@/lib/guard";
import { resolveTenant, approverMetrics, inboxFor } from "@wola/db";
import { db } from "@/lib/tenant";
import Shell from "@/components/shell";
import ReportsView from "@/components/reports-view";

export default async function ReportsPage() {
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

    if (!ctx.canSeeAllLoans) return { user, authorized: false as const };

    const inbox = await inboxFor(tx, ctx.tenantId, { userId: ctx.userId, employeeId: (me?.id as string) ?? null, role: ctx.role });
    const book = await approverMetrics(tx, inbox.length);

    // Full loan register (real).
    const loanRows = await tx`
      SELECT e.full_name AS borrower, e.employee_no, COALESCE(e.department, 'Unassigned') AS department,
             lp.name AS product, l.principal, l.annual_rate, l.tenor_months, l.status, l.start_date,
             COALESCE(
               (SELECT sl.closing_balance FROM schedule_lines sl
                  JOIN loan_schedules s ON s.id = sl.schedule_id
                 WHERE s.loan_id = l.id AND s.is_active AND sl.due_date <= CURRENT_DATE
                 ORDER BY sl.period_no DESC LIMIT 1), l.principal) AS outstanding
      FROM loans l
      JOIN loan_applications la ON la.id = l.application_id
      JOIN employees e ON e.id = la.employee_id
      JOIN loan_products lp ON lp.id = la.loan_product_id
      WHERE l.status = 'active'
      ORDER BY l.principal DESC`;
    const loans = loanRows.map((r) => ({
      borrower: r.borrower as string,
      employeeNo: r.employee_no as string,
      department: r.department as string,
      product: r.product as string,
      principal: Number(r.principal),
      rate: Number(r.annual_rate),
      tenor: Number(r.tenor_months),
      outstanding: Number(r.outstanding),
    }));

    // Application register (real).
    const appRows = await tx`
      SELECT e.full_name AS applicant, e.employee_no, lp.name AS product,
             la.amount, la.tenor_months, la.status, la.created_at
      FROM loan_applications la
      JOIN employees e ON e.id = la.employee_id
      JOIN loan_products lp ON lp.id = la.loan_product_id
      ORDER BY la.created_at DESC`;
    const applications = appRows.map((r) => ({
      applicant: r.applicant as string,
      employeeNo: r.employee_no as string,
      product: r.product as string,
      amount: Number(r.amount),
      tenor: Number(r.tenor_months),
      status: r.status as string,
      applied: r.created_at ? new Date(r.created_at as string).toISOString() : null,
    }));

    // Department breakdown (real).
    const deptRows = await tx`
      SELECT COALESCE(e.department, 'Unassigned') AS department, count(*)::int AS n, sum(l.principal) AS principal,
             sum(l.principal)::numeric AS total
      FROM loans l
      JOIN loan_applications la ON la.id = l.application_id
      JOIN employees e ON e.id = la.employee_id
      WHERE l.status = 'active'
      GROUP BY 1 ORDER BY sum(l.principal) DESC`;
    const departments = deptRows.map((r) => ({
      department: r.department as string,
      n: Number(r.n),
      principal: Number(r.principal),
    }));

    return { user, authorized: true as const, book, loans, applications, departments, tenantName: (tenant?.name as string) ?? "Wola" };
  });

  if (!data.authorized) {
    return (
      <Shell user={data.user} tenantName={(tenant?.name as string) ?? "Wola"}>
        <div className="rounded-xl border border-rule bg-surface p-8 text-center shadow-theme-sm">
          <p className="text-sm text-ink-soft">Reports are available to management roles only.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell user={data.user} tenantName={data.tenantName}>
      <ReportsView
        book={data.book}
        loans={data.loans}
        applications={data.applications}
        departments={data.departments}
        tenantName={data.tenantName}
      />
    </Shell>
  );
}
