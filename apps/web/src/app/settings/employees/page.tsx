// apps/web/src/app/settings/employees/page.tsx — HR's employee directory.
// List + bulk CSV import/update (new starters and payroll/salary refresh in
// one mechanism — see employees-actions.ts). Viewable by any full-book role
// (including auditor, read-only); the import tool itself is HR/admin-only,
// enforced again server-side in the action, and hidden here rather than
// shown-then-denied for anyone who can't use it.
import { requireSession } from "@/lib/guard";
import { resolveTenant } from "@wola/db";
import { db } from "@/lib/tenant";
import { headers } from "next/headers";
import Shell from "@/components/shell";
import EmployeeImport from "@/components/employee-import";
import CreateAccountButton from "@/components/create-account-button";
import EditEmployeeDialog from "@/components/edit-employee-dialog";
import EmployeeStatusButton from "@/components/employee-status-button";

const HR_ROLES = ["hr", "cfo", "ceo", "md", "coo", "group_ceo", "admin", "org_admin"];

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
};

const ugx = (n: string) => "UGX " + Math.round(Number(n)).toLocaleString();

export default async function EmployeesPage() {
  const slug = (await headers()).get("x-tenant-slug") ?? "";
  const tenant = slug ? await resolveTenant(db, slug) : null;

  const data = await requireSession(async (tx, ctx) => {
    const [me] = await tx`SELECT e.full_name, u.email FROM users u LEFT JOIN employees e ON e.user_id = u.id WHERE u.id = ${ctx.userId}`;
    const user = {
      name: (me?.full_name as string) ?? (me?.email as string) ?? "-",
      email: (me?.email as string) ?? "",
      role: ctx.role,
      canSeeAllLoans: ctx.canSeeAllLoans,
      canApprove: ctx.canApprove,
    };

    if (!ctx.canSeeAllLoans) return { user, authorized: false as const };

    const rows = (await tx`
      SELECT e.id, e.employee_no, e.full_name, e.department, e.title,
             e.gross_salary, e.net_salary, e.is_post_probation, e.on_final_warning,
             e.status, (e.user_id IS NOT NULL) AS has_account,
             head.employee_no AS department_head_no
      FROM employees e
      LEFT JOIN employees head ON head.id = e.department_head_id
      ORDER BY e.full_name`) as unknown as Row[];

    return { user, authorized: true as const, rows, canImport: HR_ROLES.includes(ctx.role) };
  });

  if (!data.authorized) {
    return (
      <Shell user={data.user} tenantName={(tenant?.name as string) ?? "Wola"}>
        <div className="rounded-xl border border-rule bg-surface p-8 text-center shadow-theme-sm">
          <p className="text-sm text-ink-soft">The employee directory is available to HR and management roles only.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell user={data.user} tenantName={(tenant?.name as string) ?? "Wola"}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Employee directory</h1>
          <p className="mt-1 text-sm text-ink-soft">{data.rows.length} employee{data.rows.length === 1 ? "" : "s"}.</p>
        </div>
      </div>

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
        <div className="overflow-hidden rounded-xl border border-rule bg-surface shadow-theme-sm">
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
                  <td className="font-medium text-ink">{r.full_name}</td>
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
      )}
    </Shell>
  );
}
