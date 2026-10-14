// apps/web/src/app/settings/employees/page.tsx — HR's employee directory.
// List + bulk CSV import/update (new starters and payroll/salary refresh in
// one mechanism — see employees-actions.ts). Viewable by any full-book role
// (including auditor, read-only); the import tool itself is HR/admin-only,
// enforced again server-side in the action, and hidden here rather than
// shown-then-denied for anyone who can't use it.
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { registerHealth } from "@wola/db";
import { isProvisionalEmployeeNo } from "@wola/engine";
import { requireSession } from "@/lib/guard";
import EmployeeImport from "@/components/employee-import";
import CreateAccountButton from "@/components/create-account-button";
import EditEmployeeDialog from "@/components/edit-employee-dialog";
import EmployeeStatusButton from "@/components/employee-status-button";
import { Avatar } from "@/components/ui/avatar";
import { MobileRow, MobileRowList } from "@/components/mobile-row";
import { formatMoney } from "@wola/engine";
import { getTenantCurrency } from "@/lib/tenant";
import { EMPLOYEE_DATA_ROLES as HR_ROLES } from "@/lib/permissions";
import { pageMeta } from "@/lib/site";
import Breadcrumbs from "@/components/breadcrumbs";
import AccessDenied from "@/components/access-denied";


type Row = {
  id: string;
  employee_no: string;
  full_name: string;
  department: string | null;
  department_head_no: string | null;
  title: string | null;
  gross_salary: string;
  net_salary: string;
  is_post_probation: boolean;
  on_final_warning: boolean;
  status: string;
  has_account: boolean;
  work_email: string | null;
  review_note: string | null;
};

// Small flags shown next to a person's name when their record needs a look.
function Flags({ r }: { r: Row }) {
  return (
    <>
      {isProvisionalEmployeeNo(r.employee_no) ? <span className="chip chip--awaiting" title="Temporary number: enter the real one">Temporary no.</span> : null}
      {r.review_note ? <span className="chip chip--awaiting" title={r.review_note}>Needs a look</span> : null}
    </>
  );
}

const ISSUE_LABELS: Record<string, string> = {
  missing_head: "staff missing a department head",
  missing_salary: "staff missing a salary on file",
  needs_review: "staff flagged for a decision when the list was loaded",
};
// These are fixed by typing in a table, not one person at a time: they open the sheet.
const SHEET_ISSUES: Record<string, string> = { missing_salary: "pay", missing_email: "email", provisional_id: "number" };

export const metadata = pageMeta({ title: "Employee directory", description: "Employees, departments, salaries and who has a login.", path: "/settings/employees" });

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ issue?: string }>;
}) {
  const { issue } = await searchParams;
  if (issue && SHEET_ISSUES[issue]) redirect(`/settings/employees/sheet?focus=${SHEET_ISSUES[issue]}`);
  const currency = await getTenantCurrency();
  const ugx = (n: string) => formatMoney(Number(n), currency);
  const data = await requireSession(async (tx, ctx) => {
    if (!ctx.canSeeAllLoans) return { authorized: false as const };

    const allRows = (await tx`
      SELECT e.id, e.employee_no, e.full_name, e.department, e.title,
             e.gross_salary, e.net_salary, e.is_post_probation, e.on_final_warning,
             e.status, (e.user_id IS NOT NULL) AS has_account, e.work_email, e.review_note,
             head.employee_no AS department_head_no
      FROM employees e
      LEFT JOIN employees head ON head.id = e.department_head_id
      ORDER BY e.full_name`) as unknown as Row[];

    // ?issue= is the HR dashboard's "Fix" link: show exactly the people the
    // register-health panel flagged, using the same definition it does.
    let rows = allRows;
    if (issue === "missing_head" || issue === "needs_review") {
      const health = await registerHealth(tx, ctx.tenantId);
      const ids = new Set((issue === "missing_head" ? health.missingDeptHeadPeople : health.reviewPeople).map((p) => p.id));
      rows = allRows.filter((r) => ids.has(r.id));
    }

    return { authorized: true as const, rows, canImport: HR_ROLES.includes(ctx.role) };
  });

  if (!data.authorized) {
    return (
      <AccessDenied title="Employee directory" message="The employee directory is available to HR and management roles only." />
    );
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Settings", href: "/settings" }, { label: "Employee directory" }]} />
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Employee directory</h1>
          <p className="mt-1 text-sm text-ink-soft">{data.rows.length} employee{data.rows.length === 1 ? "" : "s"}.</p>
        </div>
        {data.canImport ? (
          <Link href="/settings/employees/sheet" className="btn inline-flex h-10 items-center gap-2 rounded-full border border-rule bg-surface px-4 text-sm font-medium text-ink hover:border-ink-faint/50">
            <ClipboardList className="h-4 w-4" /> Fill in details
          </Link>
        ) : null}
      </div>

      {issue && ISSUE_LABELS[issue] ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-awaiting-wash px-4 py-2.5 text-sm text-ink">
          <span>
            Showing {data.rows.length} {ISSUE_LABELS[issue]}. Use Edit on a row to fix it.
          </span>
          <Link href="/settings/employees" className="font-medium text-brand hover:underline">
            Show everyone
          </Link>
        </div>
      ) : null}

      {data.canImport ? (
        <div className="mb-6">
          <EmployeeImport />
        </div>
      ) : null}

      {data.rows.length === 0 ? (
        <div className="rounded-xl border border-rule bg-surface p-12 text-center shadow-theme-sm">
          <p className="text-sm text-ink-soft">
            {data.canImport ? "No employees yet — import a CSV above to get started." : "No employees yet."}
          </p>
        </div>
      ) : (
        <>
        <div className="overflow-hidden rounded-2xl border border-rule bg-surface shadow-theme-xs sm:hidden">
          <MobileRowList className="border-t-0">
            {data.rows.map((r) => (
              <MobileRow
                key={r.id}
                name={r.full_name}
                title={r.full_name}
                subtitle={[r.employee_no, r.department, r.title].filter(Boolean).join(" · ")}
                value={ugx(r.gross_salary)}
                valueNote="gross"
                chip={
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <Flags r={r} />
                    <span className={r.status === "active" ? "chip chip--approved" : "chip"}>{r.status}</span>
                  </span>
                }
                actions={
                  <>
                    {r.has_account ? (
                      <span className="chip chip--approved">Login active</span>
                    ) : data.canImport ? (
                      <CreateAccountButton employeeId={r.id} />
                    ) : (
                      <span className="chip chip--awaiting">No login</span>
                    )}
                    {data.canImport ? (
                      <>
                        <EditEmployeeDialog
                          employee={{
                            id: r.id,
                            employee_no: r.employee_no,
                            work_email: r.work_email,
                            review_note: r.review_note,
                            full_name: r.full_name,
                            department: r.department,
                            department_head_no: r.department_head_no,
                            title: r.title,
                            gross_salary: r.gross_salary,
                            net_salary: r.net_salary,
                            is_post_probation: r.is_post_probation,
                            on_final_warning: r.on_final_warning,
                          }}
                        />
                        <EmployeeStatusButton employeeId={r.id} status={r.status} />
                      </>
                    ) : null}
                  </>
                }
              />
            ))}
          </MobileRowList>
        </div>
        <div className="hidden overflow-x-auto rounded-2xl border border-rule bg-surface shadow-theme-xs sm:block">
          <table className="ledger">
            <thead>
              <tr>
                <th>Name</th>
                <th>Employee no</th>
                <th>Department</th>
                <th>Title</th>
                <th className="r">Gross salary</th>
                <th className="r">Net salary</th>
                <th>Status</th>
                <th>Login</th>
                {data.canImport ? <th></th> : null}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium text-ink">
                    <span className="flex items-center gap-3">
                      <Avatar name={r.full_name} size="sm" />
                      {r.full_name}
                      <Flags r={r} />
                    </span>
                  </td>
                  <td className="num text-ink-soft">{r.employee_no}</td>
                  <td className="text-ink-soft">{r.department ?? "-"}</td>
                  <td className="text-ink-soft">{r.title ?? "-"}</td>
                  <td className="r num text-ink">{ugx(r.gross_salary)}</td>
                  <td className="r num text-ink">{ugx(r.net_salary)}</td>
                  <td>
                    <span className={r.status === "active" ? "chip chip--approved" : "chip"}>
                      {r.status}
                    </span>
                  </td>
                  <td>
                    {r.has_account ? (
                      <span className="chip chip--approved">Active</span>
                    ) : data.canImport ? (
                      <CreateAccountButton employeeId={r.id} />
                    ) : (
                      <span className="chip chip--awaiting">No login</span>
                    )}
                  </td>
                  {data.canImport ? (
                    <td className="r">
                      <div className="flex items-center justify-end gap-3">
                        <EditEmployeeDialog
                          employee={{
                            id: r.id,
                            employee_no: r.employee_no,
                            work_email: r.work_email,
                            review_note: r.review_note,
                            full_name: r.full_name,
                            department: r.department,
                            department_head_no: r.department_head_no,
                            title: r.title,
                            gross_salary: r.gross_salary,
                            net_salary: r.net_salary,
                            is_post_probation: r.is_post_probation,
                            on_final_warning: r.on_final_warning,
                          }}
                        />
                        <EmployeeStatusButton employeeId={r.id} status={r.status} />
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </>
  );
}
