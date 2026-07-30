"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, LogOut, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/apply": "Apply for a loan",
  "/loans": "Loans",
  "/approvals": "Approvals",
};

function titleFor(path: string): string {
  if (TITLES[path]) return TITLES[path];
  // longest-prefix match for nested routes like /loans/123
  const hit = Object.keys(TITLES)
    .filter((k) => k !== "/" && path.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return hit ? TITLES[hit] : "Wola";
}

const roleLabel = (r: string) =>
  r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function Topbar({
  userName,
  userEmail,
  role,
}: {
  userName: string;
  userEmail: string;
  role: string;
}) {
  const path = usePathname();

  return (
    <header className="hidden md:flex h-14 items-center justify-between border-b border-rule bg-surface px-8">
      <h1 className="text-sm font-semibold text-ink">{titleFor(path)}</h1>

      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-brand text-xs font-semibold text-brand-ink">
            {userName.charAt(0).toUpperCase()}
          </span>
          <span className="max-w-[10rem] truncate font-medium text-ink">
            {userName}
          </span>
          <ChevronDown className="h-4 w-4 text-ink-soft" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="font-medium text-ink">{userName}</div>
            <div className="truncate text-xs font-normal text-ink-soft">
              {userEmail}
            </div>
            <div className="mt-1 text-xs font-normal text-brand">
              {roleLabel(role)}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings" className="cursor-pointer">
              <User className="mr-2 h-4 w-4" />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <form action="/api/logout" method="post" className="w-full">
              <button type="submit" className="flex w-full items-center cursor-pointer">
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </button>
            </form>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
