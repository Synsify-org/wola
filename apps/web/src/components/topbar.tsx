"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Landmark, LogOut, Menu, PanelLeft, PanelLeftClose, Search, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { visibleNavItems, SETTINGS_ITEM } from "./nav-links";

const roleLabel = (r: string) => r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Jump-to-page search: filters the pages THIS role can reach (same filter as
 *  the sidebar), Enter or click navigates. Ctrl/⌘+K focuses it. It searches
 *  destinations, not records — the placeholder says so. */
function PageSearch({ canSeeAllLoans, canApprove }: { canSeeAllLoans: boolean; canApprove: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);

  const all = useMemo(() => [...visibleNavItems(canSeeAllLoans, canApprove), SETTINGS_ITEM], [canSeeAllLoans, canApprove]);
  const results = q.trim() ? all.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase())) : all;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
    router.push(href);
  };

  return (
    <div className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); setHi(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          if (e.key === "Enter" && results[hi]) go(results[hi].href);
          if (e.key === "Escape") inputRef.current?.blur();
        }}
        placeholder="Jump to a page…"
        aria-label="Jump to a page"
        role="combobox"
        aria-expanded={open}
        aria-controls="page-search-results"
        className="h-11 w-full rounded-full border border-rule bg-paper pl-10 pr-14 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-brand-300 focus:bg-surface focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100"
      />
      <kbd className="pointer-events-none absolute right-3.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-rule bg-surface px-1.5 py-0.5 text-[0.6875rem] font-medium text-ink-faint lg:block">
        Ctrl K
      </kbd>
      {open && results.length > 0 ? (
        <ul
          id="page-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-40 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-rule bg-surface p-1.5 shadow-theme-lg animate-in fade-in slide-in-from-top-1 duration-150"
        >
          {results.map((item, i) => {
            const Icon = item.icon;
            return (
              <li key={item.href} role="option" aria-selected={i === hi}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(item.href)}
                  onMouseEnter={() => setHi(i)}
                  className={
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors " +
                    (i === hi ? "bg-brand-50 text-brand-700" : "text-ink")
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export default function Topbar({
  userName,
  userEmail,
  role,
  tenantName,
  canSeeAllLoans,
  canApprove,
  collapsed,
  onToggleCollapse,
  onOpenMenu,
}: {
  userName: string;
  userEmail: string;
  role: string;
  tenantName: string;
  canSeeAllLoans: boolean;
  canApprove: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenMenu: () => void;
}) {
  const iconBtn =
    "grid h-10 w-10 shrink-0 place-items-center rounded-full border border-rule bg-surface text-ink-soft transition-all duration-150 hover:bg-paper hover:text-ink active:scale-95";

  return (
    <header className="z-30 flex h-16 shrink-0 items-center border-b border-rule bg-surface md:h-[4.5rem]">
      {/* Brand block — same width as the sidebar below it, so the two read as
          one column (the reference layout's logo + collapse toggle). */}
      <div
        className={
          "flex h-full shrink-0 items-center gap-2.5 px-4 transition-[width] duration-300 lg:px-5 " +
          (collapsed ? "lg:w-20 lg:justify-center" : "lg:w-64")
        }
      >
        <button type="button" onClick={onOpenMenu} className={iconBtn + " md:hidden"} aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/" className={"flex min-w-0 items-center gap-2.5 " + (collapsed ? "lg:hidden" : "")}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand text-brand-ink">
            <Landmark className="h-5 w-5" strokeWidth={2} />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block text-[1.0625rem] font-semibold text-ink">Wola</span>
            <span className="block truncate text-xs text-ink-soft">{tenantName}</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={onToggleCollapse}
          className={"ml-auto hidden h-9 w-9 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-paper hover:text-ink lg:grid " + (collapsed ? "lg:ml-0" : "")}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeft className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
        </button>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-3 px-4 md:justify-between md:px-8">
        <div className="hidden min-w-0 flex-1 md:block">
          <PageSearch canSeeAllLoans={canSeeAllLoans} canApprove={canApprove} />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-full p-1 pr-2 text-sm transition-colors hover:bg-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
              {userName.charAt(0).toUpperCase()}
            </span>
            <span className="hidden min-w-0 text-left leading-tight lg:block">
              <span className="block max-w-[10rem] truncate font-medium text-ink">{userName}</span>
              <span className="block text-xs text-ink-soft">{roleLabel(role)}</span>
            </span>
            <ChevronDown className="h-4 w-4 text-ink-soft" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>
              <div className="font-medium text-ink">{userName}</div>
              <div className="truncate text-xs font-normal text-ink-soft">{userEmail}</div>
              <div className="mt-1 text-xs font-normal text-brand">{roleLabel(role)}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings" className="cursor-pointer">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <form action="/api/logout" method="post" className="w-full">
                <button type="submit" className="flex w-full cursor-pointer items-center">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </button>
              </form>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
