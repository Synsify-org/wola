"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BarChart3,
  FileBarChart,
  FilePlus,
  FileText,
  Wallet,
  Building2,
  CheckSquare,
  type LucideIcon,
} from "lucide-react";

// `need` controls visibility:
//   undefined  -> everyone (employee included)
//   "approve"  -> approvers (includes dept_head): the worklist surfaces
//   "fullBook" -> whole-tenant data roles only (cfo/hr/ceo/...): analytics,
//                 reports, and the org-wide applications list
//   "oversee"  -> anyone with an oversight scope beyond their own loans: a
//                 dept head (department) or a full-book role (whole book).
//                 The label adapts: "Department" for a dept head, "Book" for
//                 full-book roles.
type Item = {
  href: string;
  label: string;
  icon: LucideIcon;
  need?: "approve" | "fullBook" | "oversee";
};

const ITEMS: Item[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/apply", label: "Apply", icon: FilePlus },
  { href: "/applications", label: "Applications", icon: FileText, need: "fullBook" },
  { href: "/loans", label: "My loans", icon: Wallet },
  { href: "/book", label: "Book", icon: Building2, need: "oversee" },
  { href: "/approvals", label: "Approvals", icon: CheckSquare, need: "approve" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, need: "fullBook" },
  { href: "/reports", label: "Reports", icon: FileBarChart, need: "fullBook" },
];

export default function NavLinks({
  canSeeAllLoans,
  canApprove,
  compact = false,
  collapsed = false,
}: {
  canSeeAllLoans: boolean;
  canApprove: boolean;
  compact?: boolean;
  collapsed?: boolean;
}) {
  const path = usePathname();
  // A dept head can oversee (approve) but not see the whole book. A full-book
  // role oversees the whole book. Employees oversee nothing.
  const canOversee = canSeeAllLoans || canApprove;
  const items = ITEMS.filter((i) => {
    if (i.need === "fullBook") return canSeeAllLoans;
    if (i.need === "approve") return canApprove;
    if (i.need === "oversee") return canOversee;
    return true;
  }).map((i) =>
    // Adapt the oversight label: dept head sees "Department", full-book "Book".
    i.href === "/book" && !canSeeAllLoans ? { ...i, label: "Department" } : i,
  );

  return (
    <>
      {items.map((item) => {
        const active =
          item.href === "/" ? path === "/" : path.startsWith(item.href);
        const Icon = item.icon;

        if (compact) {
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                active
                  ? "flex flex-col items-center gap-0.5 px-3 py-1 text-xs font-semibold text-brand"
                  : "flex flex-col items-center gap-0.5 px-3 py-1 text-xs font-semibold text-ink-faint"
              }
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            title={collapsed ? item.label : undefined}
            className={
              (active
                ? "bg-brand-50 text-brand-700 font-semibold"
                : "text-ink-soft hover:bg-gray-50 hover:text-ink font-medium") +
              " flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors " +
              (collapsed ? "justify-center" : "")
            }
          >
            <Icon className="h-4.5 w-4.5 shrink-0" />
            {collapsed ? null : <span>{item.label}</span>}
          </Link>
        );
      })}
    </>
  );
}
