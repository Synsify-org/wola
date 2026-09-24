"use client";
// apps/web/src/components/shell.tsx
// The application frame, modelled on a classic analytics layout: a
// full-width topbar (brand block + page search + user menu), a white sidebar
// beneath the brand block, and a soft grey canvas where only the content
// scrolls (desktop, lg+). Below lg the sidebar gives way to a floating
// magnifying dock: every destination on tablets; the daily four plus "More"
// (which opens the full nav as a drawer) on phones, where staff apply on cheap
// handsets. Nav is role-aware everywhere.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import NavLinks, { AppDock, SideLink, SETTINGS_ITEM, useActiveHref } from "./nav-links";
import Sidebar from "./sidebar";
import Topbar from "./topbar";

export interface ShellUser {
  name: string;
  email: string;
  role: string;
  canSeeAllLoans: boolean;
  canApprove: boolean;
}

const COLLAPSE_KEY = "wola.sidebar.collapsed";

export default function Shell({
  user,
  tenantName,
  children,
}: {
  user: ShellUser;
  tenantName: string;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const path = usePathname();
  const settingsActive = useActiveHref([SETTINGS_ITEM]) === SETTINGS_ITEM.href;

  // Remembered per browser — a convenience, so storage failures are ignored.
  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1"); } catch {}
  }, []);
  const toggleCollapse = () => {
    setCollapsed((v) => {
      try { localStorage.setItem(COLLAPSE_KEY, v ? "0" : "1"); } catch {}
      return !v;
    });
  };

  // Close the drawer on navigation and on Escape; lock page scroll while open.
  useEffect(() => { setDrawer(false); }, [path]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [drawer]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-paper">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-theme-md"
      >
        Skip to content
      </a>

      <Topbar
        userName={user.name}
        userEmail={user.email}
        role={user.role}
        tenantName={tenantName}
        canSeeAllLoans={user.canSeeAllLoans}
        canApprove={user.canApprove}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        onOpenMenu={() => setDrawer(true)}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar canSeeAllLoans={user.canSeeAllLoans} canApprove={user.canApprove} collapsed={collapsed} />

        {/* Only THIS column scrolls — sidebar and topbar stay put. */}
        <main id="main" className="min-w-0 flex-1 overflow-y-auto px-4 pb-32 pt-6 sm:px-6 md:px-8 md:pt-8 lg:pb-10">
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>

      {/* Phone + tablet menu: a floating magnifying dock (desktop keeps the
          sidebar). Phone shows the daily four + More; tablet shows everything. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-30 flex justify-center lg:hidden">
        <div className="pointer-events-auto max-w-full md:hidden">
          <AppDock variant="phone" canSeeAllLoans={user.canSeeAllLoans} canApprove={user.canApprove} onMore={() => setDrawer(true)} />
        </div>
        <div className="pointer-events-auto hidden max-w-full md:block">
          <AppDock variant="tablet" canSeeAllLoans={user.canSeeAllLoans} canApprove={user.canApprove} />
        </div>
      </div>

      {/* Mobile drawer: the full, grouped nav */}
      {drawer ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 bg-ink/30 animate-in fade-in duration-200"
          />
          <div className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col bg-surface shadow-theme-xl animate-in slide-in-from-left duration-300">
            <div className="flex h-16 items-center justify-between border-b border-rule px-4">
              <div className="min-w-0 leading-tight">
                <div className="text-[1.0625rem] font-semibold text-ink">Wola</div>
                <div className="truncate text-xs text-ink-soft">{tenantName}</div>
              </div>
              <button
                type="button"
                onClick={() => setDrawer(false)}
                aria-label="Close menu"
                className="grid h-10 w-10 place-items-center rounded-full text-ink-soft hover:bg-paper"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-4 py-5">
              <NavLinks canSeeAllLoans={user.canSeeAllLoans} canApprove={user.canApprove} onNavigate={() => setDrawer(false)} />
            </nav>
            <div className="border-t border-rule px-4 py-4">
              <SideLink item={SETTINGS_ITEM} active={settingsActive} onNavigate={() => setDrawer(false)} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
