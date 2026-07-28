"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; adminOnly?: boolean };

const ITEMS: Item[] = [
  { href: "/", label: "Dashboard" },
  { href: "/apply", label: "Apply" },
  { href: "/loans", label: "Loans" },
  { href: "/approvals", label: "Approvals", adminOnly: true },
];

export default function NavLinks({
  canSeeAllLoans,
  compact = false,
}: {
  canSeeAllLoans: boolean;
  compact?: boolean;
}) {
  const path = usePathname();
  const items = ITEMS.filter((i) => !i.adminOnly || canSeeAllLoans);

  return (
    <>
      {items.map((item) => {
        const active =
          item.href === "/" ? path === "/" : path.startsWith(item.href);

        if (compact) {
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                active
                  ? "px-3 py-1 text-xs font-semibold text-brand"
                  : "px-3 py-1 text-xs font-semibold text-ink-faint"
              }
            >
              {item.label}
            </Link>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              active
                ? "flex items-center gap-2 rounded-md border-l-2 border-brand bg-brand-wash px-3 py-2 text-sm font-medium text-brand"
                : "flex items-center gap-2 rounded-md border-l-2 border-transparent px-3 py-2 text-sm font-medium text-ink-soft hover:bg-paper hover:text-ink"
            }
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
