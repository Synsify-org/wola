// apps/web/src/app/applications/page.tsx
// The applications list. Server component: runs a read-only list query
// (inline stopgap - TODO: move to @wola/db as listApplications() once Willy
// formalizes it) and hands rows to the client table for sort/filter/search.
import { requireSession } from "@/lib/guard";
import { resolveTenant } from "@wola/db";
import { db } from "@/lib/tenant";
import { headers } from "next/headers";
import Shell from "@/components/shell";
import ApplicationsTable from "@/components/applications-table";

export type ApplicationRow = {
  id: string;
  applicantName: string;
  employeeNo: string;
  productName: string;
  productKind: string;
  purpose: string | null;
  amount: number;
  tenorMonths: number;
  status: string;
  appliedAt: string;
};

export default async function ApplicationsPage() {
  const slug = (await headers()).get("x-tenant-slug") ?? "";
  const tenant = slug ? await resolveTenant(db, slug) : null;

  const data = await requireSession(async (tx, ctx) => {
    const [me] = await tx`
      SELECT e.id, e.full_name, u.email
      FROM users u LEFT JOIN employees e ON e.user_id = u.id
      WHERE u.id = ${ctx.userId}`;

    const user = {
      name: (me?.full_name as string) ?? (me?.email as string) ?? "User",
      email: (me?.email as string) ?? "",
      role: ctx.role,
      canSeeAllLoans: ctx.canSeeAllLoans,
    };

    // RLS scopes to the tenant. Approvers see all; an employee sees only
    // their own applications.
    const rows = ctx.canSeeAllLoans
      ? await tx`
          SELECT la.id, e.full_name, e.employee_no, lp.name AS product_name,
                 lp.kind AS product_kind, la.purpose, la.amount, la.tenor_months,
                 la.status, la.created_at
          FROM loan_applications la
          JOIN employees e ON e.id = la.employee_id
          JOIN loan_products lp ON lp.id = la.loan_product_id
          ORDER BY la.created_at DESC`
      : await tx`
          SELECT la.id, e.full_name, e.employee_no, lp.name AS product_name,
                 lp.kind AS product_kind, la.purpose, la.amount, la.tenor_months,
                 la.status, la.created_at
          FROM loan_applications la
          JOIN employees e ON e.id = la.employee_id
          JOIN loan_products lp ON lp.id = la.loan_product_id
          WHERE e.user_id = ${ctx.userId}
          ORDER BY la.created_at DESC`;

    const applications: ApplicationRow[] = rows.map((r) => ({
      id: r.id as string,
      applicantName: r.full_name as string,
      employeeNo: r.employee_no as string,
      productName: r.product_name as string,
      productKind: r.product_kind as string,
      purpose: (r.purpose as string | null) ?? null,
      amount: Number(r.amount),
      tenorMonths: r.tenor_months as number,
      status: r.status as string,
      appliedAt: new Date(r.created_at as string).toISOString(),
    }));

    return { user, applications };
  });

  return (
    <Shell user={data.user} tenantName={(tenant?.name as string) ?? "Wola"}>
      <ApplicationsTable rows={data.applications} />
    </Shell>
  );
}
