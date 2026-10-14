"use client";
// The platform console's navigation: a vertical list in the sidebar on desktop and a row of
// pills across the top on phones (the console had no navigation at all on a phone before).
// The current page is highlighted, and /admin/tenants/<id> still lights up "Organisations".
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, LayoutGrid, ScrollText, ShieldCheck, type LucideIcon } from "lucide-react";

const ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/admin", label: "Overview", icon: LayoutGrid },
  { href: "/admin/tenants", label: "Organisations", icon: Building2 },
  { href: "/admin/audit-log", label: "Activity", icon: ScrollText },
  { href: "/admin/security", label: "Security", icon: ShieldCheck },
];

function useActive() {
  const path = usePathname();
  return (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(href + "/"));
}

export function SideNav() {
  const active = useActive();
  return (
    <nav aria-label="Platform" className="flex-1 space-y-1 p-3">
      {ITEMS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={active(href) ? "page" : undefined}
          className={
            "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
            (active(href) ? "bg-brand-50 text-brand-800" : "text-ink-soft hover:bg-gray-50 hover:text-ink")
          }
        >
          <Icon className="h-4 w-4" aria-hidden /> {label}
        </Link>
      ))}
    </nav>
  );
}

export function TopNav() {
  const active = useActive();
  return (
    <nav aria-label="Platform" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-3 md:hidden">
      {ITEMS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={active(href) ? "page" : undefined}
          className={
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium " +
            (active(href) ? "border-brand-200 bg-brand-50 text-brand-800" : "border-rule bg-surface text-ink-soft")
          }
        >
          <Icon className="h-4 w-4" aria-hidden /> {label}
        </Link>
      ))}
    </nav>
  );
}
