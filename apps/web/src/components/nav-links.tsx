"use client";
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

        const cls = compact
          ? (active ? "px-3 py-1 text-xs font-semibold text-brand"
                    : "px-3 py-1 text-xs font-semibold text-ink-faint")
          : (active ? "block px-3 py-2 rounded text-sm font-medium bg-brand text-brand-ink"
                    : "block px-3 py-2 rounded text-sm font-medium text-ink-soft hover:bg-paper hover:text-ink");

        return (
          <a key={item.href} href={item.href} className={cls}>
            {item.label}
          </a>
        );
      })}
    </>
  );
}
