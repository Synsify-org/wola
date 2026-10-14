import { Landmark, LogOut } from "lucide-react";
import { superLogoutAction } from "@/app/admin/actions";
import AuthFlash from "@/components/auth-flash";
import { SideNav, TopNav } from "@/components/admin/super-nav";

// The platform console's own frame, deliberately separate from the organisation app's Shell
// (which is built around an organisation and a role this surface doesn't have). A sidebar
// from md up; a brand bar with a row of navigation pills on phones. Every operator sees the
// same thing: there is no role-based branching here.
export default function SuperAdminShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const signOut = (
    <form action={superLogoutAction}>
      <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-soft transition-colors hover:bg-gray-50 hover:text-ink">
        <LogOut className="h-4 w-4" aria-hidden />
        Sign out
      </button>
    </form>
  );

  return (
    <div className="flex min-h-dvh bg-paper">
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
        <SideNav />
        <div className="border-t border-rule p-3">
          <div className="mb-2 truncate px-2 text-xs text-ink-soft">{email}</div>
          {signOut}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="border-b border-rule bg-surface px-4 pt-3 md:hidden">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand text-brand-ink">
                <Landmark className="h-5 w-5" strokeWidth={2} />
              </span>
              <div className="min-w-0 leading-tight">
                <div className="font-bold text-ink">Wola</div>
                <div className="truncate text-xs text-ink-soft">{email}</div>
              </div>
            </div>
            <div className="shrink-0">{signOut}</div>
          </div>
          <TopNav />
        </header>
        <main className="min-w-0 p-4 sm:p-6">{children}</main>
      </div>
      <AuthFlash />
    </div>
  );
}
