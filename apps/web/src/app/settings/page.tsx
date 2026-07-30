// apps/web/src/app/settings/page.tsx — account + (role-gated) admin settings.
// Today this shows the signed-in user's account details for everyone, and
// surfaces the ADMIN configuration areas (loan products, approval routing,
// employee directory, RBAC) for full-book/admin roles as a scaffold. The admin
// areas are the Company Admin panel (build plan Phase 6) — shown here as
// upcoming so the nav link is honest rather than dead.
import { requireSession } from "@/lib/guard";
import { resolveTenant } from "@wola/db";
import { db } from "@/lib/tenant";
import { headers } from "next/headers";
import Shell from "@/components/shell";
import { User, Building2, Settings as Cog, Users, GitBranch, ShieldCheck } from "lucide-react";

const ADMIN_ROLES = ["cfo", "ceo", "md", "coo", "admin"];

const roleLabel = (r: string) =>
  r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default async function SettingsPage() {
  const slug = (await headers()).get("x-tenant-slug") ?? "";
  const tenant = slug ? await resolveTenant(db, slug) : null;

  const data = await requireSession(async (tx, ctx) => {
    const [me] = await tx`
      SELECT e.full_name, e.employee_no, e.department, e.title, u.email
      FROM users u LEFT JOIN employees e ON e.user_id = u.id
      WHERE u.id = ${ctx.userId}`;
    return {
      user: {
        name: (me?.full_name as string) ?? (me?.email as string) ?? "User",
        email: (me?.email as string) ?? "",
        role: ctx.role,
        canSeeAllLoans: ctx.canSeeAllLoans,
        canApprove: ctx.canApprove,
        employeeNo: (me?.employee_no as string) ?? null,
        department: (me?.department as string) ?? null,
        title: (me?.title as string) ?? null,
      },
      isAdmin: ADMIN_ROLES.includes(ctx.role),
    };
  });

  const { user, isAdmin } = data;

  const Field = ({ label, value }: { label: string; value: string }) => (
    <div>
      <div className="caps">{label}</div>
      <div className="mt-1 text-sm text-ink">{value || "—"}</div>
    </div>
  );

  const AdminRow = ({
    icon: Icon,
    title,
    desc,
  }: {
    icon: typeof Users;
    title: string;
    desc: string;
  }) => (
    <div className="flex items-start gap-3 rounded-xl border border-rule bg-surface p-4 shadow-theme-sm">
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
        <Icon className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink">{title}</span>
          <span className="chip chip--awaiting text-[0.625rem]">Coming soon</span>
        </div>
        <p className="mt-0.5 text-xs text-ink-soft">{desc}</p>
      </div>
    </div>
  );

  return (
    <Shell user={user} tenantName={(tenant?.name as string) ?? "Wola"}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink-soft">Your account and workspace.</p>
      </div>

      {/* Account */}
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <User className="h-4 w-4 text-ink-soft" />
          <h2 className="text-sm font-semibold text-ink">Account</h2>
        </div>
        <div className="grid gap-5 rounded-xl border border-rule bg-surface p-5 shadow-theme-sm sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name" value={user.name} />
          <Field label="Email" value={user.email} />
          <Field label="Role" value={roleLabel(user.role)} />
          <Field label="Employee no" value={user.employeeNo ?? ""} />
          <Field label="Department" value={user.department ?? ""} />
          <Field label="Title" value={user.title ?? ""} />
        </div>
      </section>

      {/* Workspace */}
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <Building2 className="h-4 w-4 text-ink-soft" />
          <h2 className="text-sm font-semibold text-ink">Workspace</h2>
        </div>
        <div className="grid gap-5 rounded-xl border border-rule bg-surface p-5 shadow-theme-sm sm:grid-cols-2">
          <Field label="Company" value={(tenant?.name as string) ?? "—"} />
          <Field label="Your access" value={user.canSeeAllLoans ? "Full book" : user.canApprove ? "Approver" : "Employee"} />
        </div>
      </section>

      {/* Admin (role-gated scaffold for Phase 6) */}
      {isAdmin ? (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Cog className="h-4 w-4 text-ink-soft" />
            <h2 className="text-sm font-semibold text-ink">Administration</h2>
          </div>
          <p className="mb-3 text-xs text-ink-soft">
            Company configuration. These tools are being built.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <AdminRow icon={Cog} title="Loan products" desc="Rates, tenors, caps, and eligibility rules per product." />
            <AdminRow icon={GitBranch} title="Approval routing" desc="Who approves what, and in which order." />
            <AdminRow icon={Users} title="Employee directory" desc="Staff records, departments, and reporting lines." />
            <AdminRow icon={ShieldCheck} title="Roles & access" desc="Assign roles and permissions to staff." />
          </div>
        </section>
      ) : null}
    </Shell>
  );
}