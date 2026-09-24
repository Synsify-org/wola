"use client";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Dock, DockIcon, DockItem, DockLabel } from "@/components/ui/dock";
import {
  LayoutDashboard,
  BarChart3,
  FileBarChart,
  FilePlus,
  FileText,
  Wallet,
  Building2,
  CheckSquare,
  ScrollText,
  Users,
  Settings,
  Loader2,
  LayoutGrid,
  type LucideIcon,
} from "lucide-react";

// Per-link pending state: clicking a nav link swaps its icon for a spinner
// until the destination renders, so the click is visibly registered (the
// reported "it freezes" bug). Next's recommended pattern for this.
function NavIcon({ icon: Icon, className = "h-5 w-5 shrink-0" }: { icon: LucideIcon; className?: string }) {
  const { pending } = useLinkStatus();
  if (pending) return <Loader2 className={className + " animate-spin"} />;
  return <Icon className={className} strokeWidth={1.75} />;
}

// `need` controls visibility:
//   undefined  -> everyone (employee included)
//   "approve"  -> approvers (includes dept_head): the worklist surfaces
//   "fullBook" -> whole-tenant data roles only (cfo/hr/ceo/...)
//   "oversee"  -> a dept head (department) or a full-book role (whole book).
//                 The label adapts: "Department" vs "Book".
export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  need?: "approve" | "fullBook" | "oversee";
  group: "workspace" | "oversight" | "insights";
};

// Groups mirror the data-scope tiers in guard.ts: WORKSPACE is your own
// stuff, OVERSIGHT shows other people's data, INSIGHTS is whole-book
// reporting. Rendered as divider-separated blocks, like the reference layout.
const ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, group: "workspace" },
  { href: "/apply", label: "Apply", icon: FilePlus, group: "workspace" },
  { href: "/loans", label: "My loans", icon: Wallet, group: "workspace" },
  { href: "/applications", label: "Applications", icon: FileText, need: "fullBook", group: "oversight" },
  { href: "/book", label: "Book", icon: Building2, need: "oversee", group: "oversight" },
  { href: "/approvals", label: "Approvals", icon: CheckSquare, need: "approve", group: "oversight" },
  { href: "/settings/employees", label: "Employees", icon: Users, need: "fullBook", group: "oversight" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, need: "fullBook", group: "insights" },
  { href: "/reports", label: "Reports", icon: FileBarChart, need: "fullBook", group: "insights" },
  { href: "/audit-log", label: "Audit log", icon: ScrollText, need: "fullBook", group: "insights" },
];

export const SETTINGS_ITEM: NavItem = { href: "/settings", label: "Settings", icon: Settings, group: "workspace" };

/** The nav items this role may see — ONE filter shared by the sidebar, the
 *  mobile drawer, the mobile bottom bar and the topbar page search. */
export function visibleNavItems(canSeeAllLoans: boolean, canApprove: boolean): NavItem[] {
  const canOversee = canSeeAllLoans || canApprove;
  return ITEMS.filter((i) => {
    if (i.need === "fullBook") return canSeeAllLoans;
    if (i.need === "approve") return canApprove;
    if (i.need === "oversee") return canOversee;
    return true;
  }).map((i) => (i.href === "/book" && !canSeeAllLoans ? { ...i, label: "Department" } : i));
}

/** Longest-prefix active match, so /settings/employees lights up Employees,
 *  not Settings, and "/" only matches the dashboard itself. */
export function useActiveHref(items: NavItem[]): string | null {
  const path = usePathname();
  const hits = items
    .filter((i) => (i.href === "/" ? path === "/" : path === i.href || path.startsWith(i.href + "/")))
    .sort((a, b) => b.href.length - a.href.length);
  return hits[0]?.href ?? null;
}

export function SideLink({
  item,
  active,
  collapsed = false,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      prefetch={false}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      className={
        (active
          ? "bg-brand-50 font-semibold text-brand-700"
          : "font-medium text-ink-soft hover:bg-gray-100/70 hover:text-ink") +
        " flex items-center gap-3 rounded-xl px-3 py-2.5 text-[0.9375rem] transition-colors duration-150 active:scale-[0.99] " +
        (collapsed ? "justify-center" : "")
      }
    >
      <NavIcon icon={item.icon} />
      {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
    </Link>
  );
}

/** Sidebar / drawer nav: role-filtered items in divider-separated groups. */
export default function NavLinks({
  canSeeAllLoans,
  canApprove,
  collapsed = false,
  onNavigate,
}: {
  canSeeAllLoans: boolean;
  canApprove: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const items = visibleNavItems(canSeeAllLoans, canApprove);
  const active = useActiveHref([...items, SETTINGS_ITEM]);
  const groups = (["workspace", "oversight", "insights"] as const)
    .map((g) => items.filter((i) => i.group === g))
    .filter((g) => g.length > 0);

  return (
    <div className="space-y-4">
      {groups.map((groupItems, idx) => (
        <div key={groupItems[0].group} className={idx > 0 ? "border-t border-rule pt-4" : ""}>
          <div className="space-y-1">
            {groupItems.map((item) => (
              <SideLink key={item.href} item={item} active={active === item.href} collapsed={collapsed} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Floating magnifying dock — the phone and tablet menu (the desktop keeps
 *  the sidebar).
 *
 *  variant="phone":  the four daily destinations (Approvals promoted for
 *                    approvers) plus "More", which opens the full drawer —
 *                    so no role's menu ever overflows a narrow screen.
 *  variant="tablet": every destination the role can reach, plus Settings;
 *                    at 768px+ there's room, so no drawer is needed. */
export function AppDock({
  canSeeAllLoans,
  canApprove,
  variant,
  onMore,
}: {
  canSeeAllLoans: boolean;
  canApprove: boolean;
  variant: "phone" | "tablet";
  onMore?: () => void;
}) {
  const items = visibleNavItems(canSeeAllLoans, canApprove);
  const active = useActiveHref([...items, SETTINGS_ITEM]);

  const approvals = items.find((i) => i.href === "/approvals");
  const base = items.filter((i) => i.group === "workspace");
  const shown =
    variant === "phone"
      ? (approvals ? [base[0], approvals, ...base.slice(1)] : base).slice(0, 4)
      : [...items, SETTINGS_ITEM];
  const moreActive = variant === "phone" && active !== null && !shown.some((i) => i.href === active);

  const itemCls = (on: boolean) =>
    "rounded-full transition-colors " + (on ? "bg-brand-50 text-brand-700" : "bg-paper text-ink-soft hover:text-ink");
  const dot = <span className="absolute -bottom-2 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-brand" aria-hidden />;

  return (
    <Dock
      aria-label={variant === "phone" ? "Quick navigation" : "Main navigation"}
      className={
        "items-end border border-rule bg-surface/90 shadow-theme-lg backdrop-blur-md " +
        (variant === "phone" ? "gap-3 px-3 pb-2.5" : "gap-3.5 px-4 pb-3")
      }
      itemSize={variant === "phone" ? 44 : 40}
      magnification={variant === "phone" ? 56 : 64}
      distance={variant === "phone" ? 100 : 140}
    >
      {shown.map((item) => {
        const on = active === item.href;
        const Icon = item.icon;
        return (
          <DockItem key={item.href} href={item.href} label={item.label} active={on} className={itemCls(on)}>
            <DockLabel>{item.label}</DockLabel>
            <DockIcon>
              <Icon className="h-full w-full" strokeWidth={1.75} />
            </DockIcon>
            {on ? dot : null}
          </DockItem>
        );
      })}
      {variant === "phone" && onMore ? (
        <DockItem label="More" onClick={onMore} active={moreActive} className={itemCls(moreActive)}>
          <DockLabel>More</DockLabel>
          <DockIcon>
            <LayoutGrid className="h-full w-full" strokeWidth={1.75} />
          </DockIcon>
          {moreActive ? dot : null}
        </DockItem>
      ) : null}
    </Dock>
  );
}
