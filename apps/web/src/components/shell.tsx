// apps/web/src/components/shell.tsx
// The application frame: collapsible sidebar (desktop), topbar with user menu,
// and a mobile bottom-nav (staff apply on cheap phones). Nav is role-aware.
import NavLinks from "./nav-links";
import Sidebar from "./sidebar";
import Topbar from "./topbar";

export interface ShellUser {
  name: string;
  email: string;
  role: string;
  canSeeAllLoans: boolean;
  canApprove: boolean;
}

export default function Shell({
  user,
  tenantName,
  children,
}: {
  user: ShellUser;
  tenantName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-paper">
      <Sidebar
        canSeeAllLoans={user.canSeeAllLoans}
        canApprove={user.canApprove}
        tenantName={tenantName}
        userName={user.name}
        userRole={user.role}
      />

      {/* Only THIS column scrolls — sidebar and topbar stay put. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar userName={user.name} userEmail={user.email} role={user.role} />

        {/* Mobile top bar (identity only; nav is the bottom bar) */}
        <header className="flex items-center justify-between border-b border-rule bg-surface px-4 py-3 md:hidden">
          <span className="font-bold text-brand">Wola</span>
          <span className="truncate text-xs text-ink-soft">{tenantName}</span>
        </header>

        <main className="w-full flex-1 overflow-y-auto px-4 py-8 pb-24 md:px-8 md:pb-8">
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>

        {/* Mobile bottom nav */}
        <nav className="fixed inset-x-0 bottom-0 flex justify-around border-t border-rule bg-surface py-2 md:hidden">
          <NavLinks canSeeAllLoans={user.canSeeAllLoans} canApprove={user.canApprove} compact />
        </nav>
      </div>
    </div>
  );
}
