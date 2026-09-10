import Link from "next/link";
import { Landmark, LayoutGrid, Building2, ScrollText, LogOut } from "lucide-react";
import { superLogoutAction } from "@/app/admin/actions";

// The super-admin surface's own chrome — deliberately separate from Shell
// (the tenant app's shell), which is built around a tenant/role identity
// this surface doesn't have. Intentionally lean per the architecture doc:
// forest-green brand mark, a left nav, three tabs. No role-based nav
// branching — every super-admin sees the same thing.
export default function SuperAdminShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const navItem = (href: string, label: string, Icon: typeof LayoutGrid) => (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-gray-50 hover:text-ink"
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );

  return (
    <div className="flex min-h-screen bg-paper">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-rule bg-surface md:flex">
        <div className="flex h-16 items-center gap-2.5 border-b border-rule px-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand text-brand-ink">
            <Landmark className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <div className="text-base font-bold leading-tight text-ink">Wola</div>
            <div className="truncate text-xs text-ink-soft">Platform admin</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {navItem("/admin", "Overview", LayoutGrid)}
          {navItem("/admin/tenants", "Tenant registry", Building2)}
          {navItem("/admin/audit-log", "Audit logs", ScrollText)}
        </nav>
        <div className="border-t border-rule p-3">
          <div className="mb-2 truncate px-2 text-xs text-ink-soft">{email}</div>
          <form action={superLogoutAction}>
            <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-soft transition-colors hover:bg-gray-50 hover:text-ink">
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
