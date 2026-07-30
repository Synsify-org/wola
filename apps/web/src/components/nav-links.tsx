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
  CheckSquare,
  type LucideIcon,
} from "lucide-react";

type Item = { href: string; label: string; icon: LucideIcon; adminOnly?: boolean };

const ITEMS: Item[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/apply", label: "Apply", icon: FilePlus },
  { href: "/applications", label: "Applications", icon: FileText, adminOnly: true },
  { href: "/loans", label: "Loans", icon: Wallet },
  { href: "/approvals", label: "Approvals", icon: CheckSquare, adminOnly: true },
  { href: "/analytics", label: "Analytics", icon: BarChart3, adminOnly: true },
  { href: "/reports", label: "Reports", icon: FileBarChart, adminOnly: true },
];

export default function NavLinks({
  canSeeAllLoans,
  compact = false,
  collapsed = false,
}: {
  canSeeAllLoans: boolean;
  compact?: boolean;
  collapsed?: boolean;
}) {
  const path = usePathname();
  const items = ITEMS.filter((i) => !i.adminOnly || canSeeAllLoans);

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
