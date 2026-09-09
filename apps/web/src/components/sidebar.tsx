"use client";
import { useState } from "react";
import NavLinks from "./nav-links";
import { PanelLeftClose, PanelLeft, Landmark } from "lucide-react";

export default function Sidebar({
  canSeeAllLoans,
  canApprove,
  tenantName,
  userName,
  userRole,
}: {
  canSeeAllLoans: boolean;
  canApprove: boolean;
  tenantName: string;
  userName: string;
  userRole: string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const roleLabel = userRole
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <aside
      className={
        "hidden shrink-0 flex-col border-r border-rule bg-surface transition-all duration-300 md:flex " +
        (collapsed ? "w-19" : "w-64")
      }
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 border-b border-rule px-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand text-brand-ink">
          <Landmark className="h-5 w-5" strokeWidth={2} />
        </span>
        {collapsed ? null : (
          <div className="min-w-0">
            <div className="text-base font-bold leading-tight text-ink">Wola</div>
            <div className="truncate text-xs text-ink-soft">{tenantName}</div>
          </div>
        )}
      </div>

      {/* Nav — NavLinks renders its own grouped section headers. */}
      <nav className="flex-1 overflow-y-auto p-3">
        <NavLinks canSeeAllLoans={canSeeAllLoans} canApprove={canApprove} collapsed={collapsed} />
      </nav>

      {/* Footer: user + collapse toggle */}
      <div className="border-t border-rule p-3">
        {collapsed ? null : (
          <div className="mb-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-xs font-semibold text-brand-ink">
              {userName.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink">{userName}</div>
              <div className="truncate text-xs text-ink-soft">{roleLabel}</div>
            </div>
          </div>
        )}
        <button
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Expand" : "Collapse"}
          className={
            "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-soft transition-colors hover:bg-gray-50 hover:text-ink " +
            (collapsed ? "justify-center" : "")
          }
        >
          {collapsed ? (
            <PanelLeft className="h-4.5 w-4.5" />
          ) : (
            <>
              <PanelLeftClose className="h-4.5 w-4.5" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
