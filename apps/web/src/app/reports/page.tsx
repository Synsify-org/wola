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
      canApprove: ctx.canApprove,
    };

    if (!ctx.canSeeAllLoans) return { user, authorized: false as const };

    const inbox = await inboxFor(tx, ctx.tenantId, { userId: ctx.userId, employeeId: (me?.id as string) ?? null, role: ctx.role });
    const book = await approverMetrics(tx, inbox.length);

    // Full loan register (real) — now including ARREARS: instalments due to
    // date minus what's actually been repaid (ledger), the real collections
    // gap, not a projection. This is what a board/audit reader needs beyond
    // "outstanding" — outstanding drops even for a loan that's behind, as
    // long as SOME repayment landed; arrears is what's actually late.
    const loanRows = await tx`
      SELECT e.full_name AS borrower, e.employee_no, COALESCE(e.department, 'Unassigned') AS department,
             lp.name AS product, l.principal, l.annual_rate, l.tenor_months, l.status, l.start_date,
             GREATEST(l.principal - COALESCE(
               (SELECT sum((r.allocation->>'principal')::numeric)
                  FROM repayments r WHERE r.loan_id = l.id),
               0
             ), 0) AS outstanding,
             GREATEST(
               COALESCE(
                 (SELECT sum(sl.instalment) FROM schedule_lines sl
                    JOIN loan_schedules s ON s.id = sl.schedule_id
                   WHERE s.loan_id = l.id AND s.is_active AND sl.due_date <= CURRENT_DATE),
                 0
               ) - COALESCE((SELECT sum(r.amount) FROM repayments r WHERE r.loan_id = l.id), 0),
               0
             ) AS arrears
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
      // annual_rate is stored as a fraction (0.095 = 9.5%) — see resolveRate()
      // in approvals.ts. reports-view.tsx displays `rate` directly as a percent.
      rate: Number(r.annual_rate) * 100,
      tenor: Number(r.tenor_months),
      outstanding: Number(r.outstanding),
      arrears: Number(r.arrears),
    }));

    const totalArrears = loans.reduce((s, l) => s + l.arrears, 0);
    const overdueCount = loans.filter((l) => l.arrears > 0.01).length;
    const totalOutstanding = loans.reduce((s, l) => s + l.outstanding, 0);
    const parRatio = totalOutstanding > 0 ? (totalArrears / totalOutstanding) * 100 : 0;

    // Actual interest COLLECTED (real, from the repayment ledger) vs the
    // "if every loan runs to term" projection already in `book.interestBook`
    // — collections performance, the board-relevant version of "interest".
    const [actualInterestRow] = await tx`
      SELECT COALESCE(sum((r.allocation->>'interest')::numeric), 0) AS actual_interest
      FROM repayments r`;
    const actualInterestCollected = Number(actualInterestRow?.actual_interest ?? 0);

    // Top exposure concentration — a standard audit/board question. Per
    // BORROWER, not per loan: someone with two active loans is one line of
    // concentration risk, not two (and two loan rows sharing an employee_no
    // was also a real React key collision on the client).
    const topBorrowerRows = await tx`
      SELECT e.full_name AS borrower, e.employee_no,
             sum(GREATEST(l.principal - COALESCE(
               (SELECT sum((r.allocation->>'principal')::numeric) FROM repayments r WHERE r.loan_id = l.id), 0
             ), 0)) AS outstanding
      FROM loans l
      JOIN loan_applications la ON la.id = l.application_id
      JOIN employees e ON e.id = la.employee_id
      WHERE l.status = 'active'
      GROUP BY e.full_name, e.employee_no
      ORDER BY outstanding DESC
      LIMIT 5`;
    const topBorrowers = topBorrowerRows.map((r) => ({
      borrower: r.borrower as string,
      employeeNo: r.employee_no as string,
      outstanding: Number(r.outstanding),
    }));

    // Approval audit trail — a flat, chronological ledger of every decision:
    // who, what stage, when. This is the paper trail an audit actually asks
    // for, distinct from the loan/application registers above.
    const trailRows = await tx`
      SELECT e.full_name AS borrower, e.employee_no, lp.name AS product,
             a.decision, a.comment, a.decided_at,
             COALESCE(ast.approver_role, 'unknown') AS stage_role,
             u.email AS approver_email
      FROM approvals a
      JOIN loan_applications la ON la.id = a.application_id
      JOIN employees e ON e.id = la.employee_id
      JOIN loan_products lp ON lp.id = la.loan_product_id
      LEFT JOIN approval_stages ast ON ast.id = a.stage_id
      LEFT JOIN users u ON u.id = a.approver_user_id
      WHERE a.decision IN ('approved', 'rejected')
      ORDER BY a.decided_at DESC
      LIMIT 200`;
    const approvalTrail = trailRows.map((r) => ({
      borrower: r.borrower as string,
      employeeNo: r.employee_no as string,
      product: r.product as string,
      decision: r.decision as string,
      comment: r.comment as string | null,
      decidedAt: r.decided_at ? new Date(r.decided_at as string).toISOString() : null,
      stageRole: r.stage_role as string,
      approverEmail: (r.approver_email as string | null) ?? "-",
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

    return {
      user, authorized: true as const, book, loans, applications, departments,
      tenantName: (tenant?.name as string) ?? "Wola",
      totalArrears, overdueCount, parRatio, actualInterestCollected,
      topBorrowers, approvalTrail,
    };
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

  const brand = ((tenant?.settings ?? {}) as { brand?: { primary?: string; accent?: string } }).brand ?? {};

  return (
    <Shell user={data.user} tenantName={data.tenantName}>
      <ReportsView
        book={data.book}
        loans={data.loans}
        applications={data.applications}
        departments={data.departments}
        tenantName={data.tenantName}
        brandPrimary={brand.primary ?? "#16A34A"}
        brandAccent={brand.accent ?? "#FACC15"}
        totalArrears={data.totalArrears}
        overdueCount={data.overdueCount}
        parRatio={data.parRatio}
        actualInterestCollected={data.actualInterestCollected}
        topBorrowers={data.topBorrowers}
        approvalTrail={data.approvalTrail}
      />
    </Shell>
  );
}
