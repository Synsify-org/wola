// "Fill in details": the sheet HR (or an administrator) uses to complete what the organisation's own
// staff list did not contain: pay, probation status, work email, real employee numbers.
import Link from "next/link";
import { isProvisionalEmployeeNo } from "@wola/engine";
import { requireSession } from "@/lib/guard";
import { EMPLOYEE_DATA_ROLES as HR_ROLES } from "@/lib/permissions";
import { pageMeta } from "@/lib/site";
import Breadcrumbs from "@/components/breadcrumbs";
import AccessDenied from "@/components/access-denied";
import DetailsSheet, { type SheetPerson } from "@/components/details-sheet";

export const metadata = pageMeta({ title: "Fill in staff details", description: "Pay, probation status, work emails and employee numbers.", path: "/settings/employees/sheet" });

const FOCUS: Record<string, string> = { pay: "Missing pay", email: "Missing email", number: "Temporary number" };

export default async function DetailsSheetPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const { focus } = await searchParams;
  const data = await requireSession(async (tx, ctx) => {
    if (!HR_ROLES.includes(ctx.role)) return { authorized: false as const };
    const rows = await tx`
      SELECT e.id, e.employee_no, e.full_name, e.department, e.title,
             e.gross_salary::float AS gross, e.net_salary::float AS net, e.is_post_probation,
             e.work_email, (e.user_id IS NOT NULL) AS has_login, e.review_note
      FROM employees e WHERE e.tenant_id = ${ctx.tenantId} AND e.status = 'active'
      ORDER BY e.full_name`;
    return { authorized: true as const, rows };
  });

  if (!data.authorized) return <AccessDenied title="Fill in details" message="Staff details are available to HR and administrators." />;

  const all: SheetPerson[] = data.rows.map((r) => ({
    id: r.id as string, employeeNo: r.employee_no as string, name: r.full_name as string,
    department: r.department as string | null, title: r.title as string | null,
    gross: Number(r.gross), net: Number(r.net), postProbation: Boolean(r.is_post_probation),
    workEmail: r.work_email as string | null, hasLogin: Boolean(r.has_login), note: r.review_note as string | null,
  }));
  const missing = {
    pay: all.filter((p) => !p.gross || !p.net),
    email: all.filter((p) => !p.hasLogin && !p.workEmail),
    number: all.filter((p) => isProvisionalEmployeeNo(p.employeeNo)),
  };
  const people = focus && focus in missing ? missing[focus as keyof typeof missing] : all;

  const chip = (href: string, label: string, active: boolean) => (
    <Link key={href} href={href} aria-current={active ? "page" : undefined}
      className={"rounded-full border px-3.5 py-1.5 text-sm font-medium " + (active ? "border-brand-200 bg-brand-50 text-brand-800" : "border-rule bg-surface text-ink-soft hover:text-ink")}>
      {label}
    </Link>
  );

  return (
    <>
      <Breadcrumbs items={[{ label: "Settings", href: "/settings" }, { label: "Employee directory", href: "/settings/employees" }, { label: "Fill in details" }]} />
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-ink">Fill in staff details</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          Type in what the organisation&apos;s own list did not have. Highlighted boxes are still empty. Pay decides how much each person may borrow, so every change is recorded with who made it.
        </p>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {chip("/settings/employees/sheet", `Everyone (${all.length})`, !focus || !(focus in missing))}
        {(Object.keys(FOCUS) as (keyof typeof missing)[]).map((k) => chip(`/settings/employees/sheet?focus=${k}`, `${FOCUS[k]} (${missing[k].length})`, focus === k))}
      </div>
      <DetailsSheet key={focus ?? "all"} people={people} />
    </>
  );
}
