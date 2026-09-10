// apps/web/src/app/settings/page.tsx — account + (role-gated) admin settings.
// Today this shows the signed-in user's account details for everyone, and
// surfaces the ADMIN configuration areas (loan products, approval routing,
// employee directory, RBAC) for full-book/admin roles as a scaffold. The admin
// areas are the Company Admin panel (build plan Phase 6) — shown here as
// upcoming so the nav link is honest rather than dead.
import { requireSession } from "@/lib/guard";
import { resolveTenant, listCurrentRateIndices, productsMissingRateIndex } from "@wola/db";
import { db } from "@/lib/tenant";
import { headers } from "next/headers";
import Link from "next/link";
import Shell from "@/components/shell";
import ThemeEditor from "@/components/theme-editor";
import RateIndexEditor from "@/components/rate-index-editor";
import DashboardCard from "@/components/dashboard-card";
import { User, Building2, Settings as Cog, Users, GitBranch, ShieldCheck, ArrowRight } from "lucide-react";

const ADMIN_ROLES = ["cfo", "ceo", "md", "coo", "group_ceo", "admin", "org_admin"];

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
    // Current brand (for the theme editor), from tenants.settings.brand.
    const [t] = await tx`SELECT settings FROM tenants WHERE id = ${ctx.tenantId}`;
    const brand = ((t?.settings ?? {}) as { brand?: { primary?: string; accent?: string; font?: string } }).brand ?? {};

    const isAdmin = ADMIN_ROLES.includes(ctx.role);
    const rateIndices = isAdmin ? await listCurrentRateIndices(tx, ctx.tenantId) : [];
    const productsMissing = isAdmin ? await productsMissingRateIndex(tx, ctx.tenantId) : [];

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
      isAdmin,
      rateIndices,
      productsMissing,
      brandPrimary: brand.primary ?? "#16A34A",
      brandAccent: brand.accent ?? "#FACC15",
      brandFont: brand.font ?? "outfit",
    };
  });

  const { user, isAdmin, rateIndices, productsMissing, brandPrimary, brandAccent, brandFont } = data;

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
    href,
  }: {
    icon: typeof Users;
    title: string;
    desc: string;
    /** When set, this row is a live link instead of a "Coming soon" stub. */
    href?: string;
  }) => {
    const body = (
      <>
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink">{title}</span>
            {href ? null : <span className="chip chip--awaiting text-[0.625rem]">Coming soon</span>}
          </div>
          <p className="mt-0.5 text-xs text-ink-soft">{desc}</p>
        </div>
        {href ? <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-ink-faint" /> : null}
      </>
    );

    if (href) {
      return (
        <Link
          href={href}
          className="flex items-start gap-3 rounded-xl border border-rule bg-surface p-4 shadow-theme-sm transition-colors hover:border-brand-200 hover:bg-brand-wash"
        >
          {body}
        </Link>
      );
    }
    return <div className="flex items-start gap-3 rounded-xl border border-rule bg-surface p-4 shadow-theme-sm">{body}</div>;
  };

  return (
    <Shell user={user} tenantName={(tenant?.name as string) ?? "Wola"}>
      <div className="mb-6 animate-in fade-in slide-in-from-bottom-1 duration-500">
        <h1 className="text-xl font-semibold text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink-soft">Your account and workspace.</p>
      </div>

      {/* Account + Workspace side by side — related, both read-only identity
          info, no reason to stack them full-width on a wide screen. */}
      <section className="mb-6 grid gap-4 lg:grid-cols-2 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <DashboardCard title="Account" action={<User className="h-4 w-4 text-ink-faint" />}>
          <div className="grid grid-cols-2 gap-5">
            <Field label="Name" value={user.name} />
            <Field label="Email" value={user.email} />
            <Field label="Role" value={roleLabel(user.role)} />
            <Field label="Employee no" value={user.employeeNo ?? ""} />
            <Field label="Department" value={user.department ?? ""} />
            <Field label="Title" value={user.title ?? ""} />
          </div>
        </DashboardCard>

        <DashboardCard title="Workspace" action={<Building2 className="h-4 w-4 text-ink-faint" />}>
          <div className="grid grid-cols-2 gap-5">
            <Field label="Company" value={(tenant?.name as string) ?? "—"} />
            <Field label="Your access" value={user.canSeeAllLoans ? "Full book" : user.canApprove ? "Approver" : "Employee"} />
          </div>
        </DashboardCard>
      </section>

      {/* Admin (role-gated scaffold for Phase 6) */}
      {isAdmin ? (
        <section className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150">
          <div className="mb-3 flex items-center gap-2">
            <Cog className="h-4 w-4 text-ink-soft" />
            <h2 className="text-sm font-semibold text-ink">Administration</h2>
          </div>

          {/* Working now: brand theming. */}
          <div className="mb-3">
            <p className="mb-2 text-xs text-ink-soft">
              Set your company brand colours — they apply across the whole app.
            </p>
            <ThemeEditor initialPrimary={brandPrimary} initialAccent={brandAccent} initialFont={brandFont} />
          </div>

          <div className="mb-3 mt-6">
            <p className="mb-2 text-xs text-ink-soft">
              Rates referenced by interest-bearing loan products (e.g. the BoU CBR).
            </p>
            <RateIndexEditor indices={rateIndices} productsMissing={productsMissing} />
          </div>

          <p className="mb-3 mt-6 text-xs text-ink-soft">
            More configuration tools are being built.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <AdminRow icon={Cog} title="Loan products" desc="Rates, tenors, caps, and eligibility rules per product." />
            <AdminRow icon={GitBranch} title="Approval routing" desc="Who approves what, and in which order." />
            <AdminRow icon={Users} title="Employee directory" desc="Staff records, departments, and reporting lines." href="/settings/employees" />
            <AdminRow icon={ShieldCheck} title="Roles & access" desc="Assign roles and permissions to staff." />
          </div>
        </section>
      ) : null}
    </Shell>
  );
}
