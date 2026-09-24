"use client";
import NavLinks, { SideLink, SETTINGS_ITEM, useActiveHref } from "./nav-links";

// Desktop sidebar: white column under the topbar's brand block, role-filtered
// nav in divider-separated groups, Settings pinned to the bottom. Collapse
// state lives in Shell (the toggle sits in the topbar brand block).
export default function Sidebar({
  canSeeAllLoans,
  canApprove,
  collapsed,
}: {
  canSeeAllLoans: boolean;
  canApprove: boolean;
  collapsed: boolean;
}) {
  const active = useActiveHref([SETTINGS_ITEM]);

  return (
    <aside
      aria-label="Main navigation"
      className={
        "hidden shrink-0 flex-col border-r border-rule bg-surface transition-[width] duration-300 lg:flex " +
        (collapsed ? "w-20" : "w-64")
      }
    >
      <nav className="flex-1 overflow-y-auto px-4 py-6">
        <NavLinks canSeeAllLoans={canSeeAllLoans} canApprove={canApprove} collapsed={collapsed} />
      </nav>
      <div className="border-t border-rule px-4 py-4">
        <SideLink item={SETTINGS_ITEM} active={active === SETTINGS_ITEM.href} collapsed={collapsed} />
      </div>
    </aside>
  );
}
