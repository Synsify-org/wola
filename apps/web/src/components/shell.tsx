// apps/web/src/components/shell.tsx
// The application frame: sidebar, tenant identity, user context, sign out.
// Nav items are ROLE-AWARE — an ordinary employee has no approval inbox and
// no register of everyone else's loans, so they never see those links.
import { headers } from "next/headers";
import NavLinks from "./nav-links";

export interface ShellUser {
  name: string;
  email: string;
  role: string;
  canSeeAllLoans: boolean;
}

const roleLabel = (r: string) =>
  r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default async function Shell({
  user,
  tenantName,
  children,
}: {
  user: ShellUser;
  tenantName: string;
  children: React.ReactNode;
}) {
  const slug = (await headers()).get("x-tenant-slug") ?? "";

  return (
    <div className="min-h-screen flex">
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside
        className="hidden md:flex w-64 shrink-0 flex-col justify-between
                   border-r border-rule bg-surface"
      >
        <div>
          <div className="px-6 py-6 border-b border-rule">
            <div className="text-lg font-bold text-brand leading-tight">
              {tenantName}
            </div>
            <div className="caps mt-1">Staff Loan Portal</div>
          </div>

          <nav className="p-3">
            <NavLinks canSeeAllLoans={user.canSeeAllLoans} />
          </nav>
        </div>

        <div className="p-3 border-t border-rule">
          <div className="px-3 py-2">
            <div className="text-sm font-semibold truncate">{user.name}</div>
            <div className="text-xs text-ink-soft truncate">{user.email}</div>
            <div className="caps mt-1">{roleLabel(user.role)}</div>
          </div>
          <form action="/api/logout" method="post" className="px-3 pt-2">
            <button type="submit" className="text-sm text-ink-soft hover:text-ink">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* ── Content ─────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">
        {/* Mobile bar — the sidebar collapses; identity stays visible. */}
        <header className="md:hidden flex items-center justify-between
                           px-4 py-3 border-b border-rule bg-surface">
          <span className="font-bold text-brand">{tenantName}</span>
          <form action="/api/logout" method="post">
            <button type="submit" className="text-sm text-ink-soft">Sign out</button>
          </form>
        </header>

        <main className="max-w-5xl mx-auto px-4 md:px-10 py-8 pb-24 md:pb-8">
          {children}
        </main>

        {/* Mobile nav — a bottom bar, because staff apply on cheap phones. */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 border-t border-rule
                        bg-surface flex justify-around py-2">
          <NavLinks canSeeAllLoans={user.canSeeAllLoans} compact />
        </nav>
      </div>
    </div>
  );
}