// apps/web/src/components/shell.tsx
// The application frame: sidebar (desktop), topbar with user menu, and a
// mobile bottom-nav (staff apply on cheap phones). Nav is role-aware.
import NavLinks from "./nav-links";
import Topbar from "./topbar";

export interface ShellUser {
  name: string;
  email: string;
  role: string;
  canSeeAllLoans: boolean;
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
    <div className="flex min-h-screen bg-paper">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-rule bg-surface md:flex">
        <div className="border-b border-rule px-6 py-5">
          <div className="text-lg font-bold leading-tight text-brand">Wola</div>
          <div className="truncate text-xs text-ink-soft">{tenantName}</div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          <NavLinks canSeeAllLoans={user.canSeeAllLoans} />
        </nav>
      </aside>

      {/* Right column: topbar + content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar userName={user.name} userEmail={user.email} role={user.role} />

        {/* Mobile top bar (identity only; nav is the bottom bar) */}
        <header className="flex items-center justify-between border-b border-rule bg-surface px-4 py-3 md:hidden">
          <span className="font-bold text-brand">Wola</span>
          <span className="truncate text-xs text-ink-soft">{tenantName}</span>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 pb-24 md:px-8 md:pb-8">
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav className="fixed inset-x-0 bottom-0 flex justify-around border-t border-rule bg-surface py-2 md:hidden">
          <NavLinks canSeeAllLoans={user.canSeeAllLoans} compact />
        </nav>
      </div>
    </div>
  );
}
