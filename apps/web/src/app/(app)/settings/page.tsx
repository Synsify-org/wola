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
import ThemeEditor from "@/components/theme-editor";
import RateIndexEditor from "@/components/rate-index-editor";
import { RATE_INDEX_EDIT_ROLES, CONFIG_VIEW_ROLES } from "@/lib/permissions";
import DashboardCard from "@/components/dashboard-card";
import { User, Building2, Settings as Cog, Users, GitBranch, ShieldCheck, ArrowRight, UserMinus } from "lucide-react";
import MyDetailsForm from "@/components/my-details-form";
import LoanExitPolicy from "@/components/loan-exit-policy";
import { can } from "@/lib/permissions";
import { pageMeta } from "@/lib/site";
import { roleLabel } from "@/lib/product-summary";

const ADMIN_ROLES = CONFIG_VIEW_ROLES;


export const metadata = pageMeta({ title: "Settings", description: "Your account, your organisation and its configuration.", path: "/settings" });

export default async function SettingsPage() {
  const slug = (await headers()).get("x-tenant-slug") ?? "";
  const tenant = slug ? await resolveTenant(db, slug) : null;

  const data = await requireSession(async (tx, ctx) => {
    const [me] = await tx`
      SELECT e.id AS employee_id, e.full_name, e.employee_no, e.department, e.title, e.phone, e.location, u.email
      FROM users u LEFT JOIN employees e ON e.user_id = u.id
      WHERE u.id = ${ctx.userId}`;
    // Current brand (for the theme editor), from tenants.settings.brand.
    const [t] = await tx`SELECT settings FROM tenants WHERE id = ${ctx.tenantId}`;
    const settings = (t?.settings ?? {}) as { brand?: { primary?: string; accent?: string; font?: string }; loanExit?: { policy?: string } };
    const brand = settings.brand ?? {};
    const exitPolicy: "recover_balance" | "manual" = settings.loanExit?.policy === "manual" ? "manual" : "recover_balance";

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
        phone: (me?.phone as string) ?? "",
        location: (me?.location as string) ?? "",
        hasRecord: Boolean(me?.employee_id),
      },
      exitPolicy,
      canEditPolicy: can(ctx.role, "access.edit"),
      isAdmin,
      rateIndices,
      productsMissing,
      brandPrimary: brand.primary ?? "#16A34A",
      brandAccent: brand.accent ?? "#FACC15",
      brandFont: brand.font ?? "segoe",
    };
  });

  const { user, isAdmin, rateIndices, productsMissing, brandPrimary, brandAccent, brandFont, exitPolicy, canEditPolicy } = data;

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
    <>
      <div className="mb-6 animate-in fade-in slide-in-from-bottom-1 duration-500">
        <h1 className="text-xl font-semibold text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink-soft">Your account and workspace.</p>
      </div>

      {/* Your details (editable contact info) beside the quiet read-only cards. One column
          on a phone, details first. */}
      <section className="mb-6 grid grid-cols-1 gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 lg:grid-cols-3 xl:gap-5">
        <DashboardCard title="Your details" action={<User className="h-4 w-4 text-ink-faint" />} className="lg:col-span-2">
          <MyDetailsForm
            name={user.name} email={user.email} employeeNo={user.employeeNo ?? ""} department={user.department ?? ""} title={user.title ?? ""}
            phone={user.phone} location={user.location} hasRecord={user.hasRecord}
          />
        </DashboardCard>

        <div className="grid content-start gap-4 xl:gap-5">
          <DashboardCard title="Account" action={<ShieldCheck className="h-4 w-4 text-ink-faint" />}>
            <div className="grid grid-cols-2 gap-5">
              <Field label="Role" value={roleLabel(user.role)} />
              <Field label="Your access" value={user.canSeeAllLoans ? "Full book" : user.canApprove ? "Approver" : "Employee"} />
            </div>
            <Link href="/settings/security" className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
              <ShieldCheck className="h-4 w-4" aria-hidden /> Security and two-step sign-in <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </DashboardCard>

          <DashboardCard title="Workspace" action={<Building2 className="h-4 w-4 text-ink-faint" />}>
            <Field label="Company" value={(tenant?.name as string) ?? "—"} />
          </DashboardCard>
        </div>
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
            <RateIndexEditor
              indices={rateIndices}
              productsMissing={productsMissing}
              canEdit={RATE_INDEX_EDIT_ROLES.includes(user.role)}
            />
          </div>

          <div className="mb-3 mt-6">
            <DashboardCard title="When a borrower leaves" action={<UserMinus className="h-4 w-4 text-ink-faint" />}>
              <LoanExitPolicy initial={exitPolicy} canEdit={canEditPolicy} />
            </DashboardCard>
          </div>

          <p className="mb-3 mt-6 text-xs text-ink-soft">
            Configuration tools.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <AdminRow icon={Cog} title="Loan products" desc="Rates, tenors, caps, and eligibility rules per product." href="/settings/products" />
            <AdminRow icon={GitBranch} title="Approval routing" desc="Who approves what, and in which order." href="/settings/routing" />
            <AdminRow icon={Users} title="Employee directory" desc="Staff records, departments, and reporting lines." href="/settings/employees" />
            <AdminRow icon={ShieldCheck} title="Roles & access" desc="Assign roles and permissions to staff." href="/settings/access" />
          </div>
        </section>
      ) : null}
    </>
  );
}
