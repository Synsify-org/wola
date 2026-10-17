// apps/web/src/components/stat-card.tsx
// The dashboard KPI tile: a solid, tinted card with one quiet decorative shape,
// a dominant number, a period-over-period badge and a "vs last month" footer.
// Adapted from the statistics-card-2 reference to Wola's theme:
//
//  * Tones are built from the TENANT BRAND scale (brand / deep) plus fixed,
//    dark-enough neutrals and state colours, so every tile passes contrast with
//    white text and a white-labelled tenant still looks like itself. (The
//    reference's fuchsia / teal fills are not tenant-themeable.)
//  * Decoration uses `currentColor`, so it follows the text colour whatever
//    the tone is.
//  * The tile is `relative overflow-hidden`: the decorative SVG is absolutely
//    positioned and must be contained by it.
//  * The optional menu holds only REAL destinations (links). No fake actions.
import Link from "next/link";
import { ArrowDown, ArrowUp, MoreHorizontal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge-2";
import { Button } from "@/components/ui/button-1";
import { Card, CardContent, CardHeader, CardTitle, CardToolbar } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type StatTone = "brand" | "deep" | "ink" | "info" | "teal" | "success" | "warn" | "danger";
export type StatDelta = { dir: "up" | "down"; pct: number; note: string };
export type StatMenuLink = { label: string; href: string; icon?: LucideIcon };

// Every fill keeps white (or brand-ink) text at >= 4.5:1.
const TONE: Record<StatTone, string> = {
  brand: "bg-gradient-to-br from-brand-600 to-brand-700 text-brand-ink",
  deep: "bg-gradient-to-br from-brand-800 to-brand-900 text-brand-ink",
  ink: "bg-gradient-to-br from-zinc-800 to-zinc-950 text-white",
  info: "bg-gradient-to-br from-info-600 to-info-700 text-white",
  teal: "bg-gradient-to-br from-teal-700 to-teal-800 text-white",
  success: "bg-gradient-to-br from-success-700 to-[#05603a] text-white",
  warn: "bg-gradient-to-br from-warning-700 to-[#93370d] text-white",
  danger: "bg-gradient-to-br from-error-600 to-error-700 text-white",
};

/** One quiet shape in the card's top-right corner, the same on every tile: enough to
 *  keep a solid fill from looking flat, not enough to compete with the number. */
function Pattern() {
  return (
    <svg className="pointer-events-none absolute right-0 top-0 h-full w-1/2 text-current" viewBox="0 0 200 200" fill="none" aria-hidden focusable="false">
      <circle cx="190" cy="10" r="110" fill="currentColor" fillOpacity="0.06" />
    </svg>
  );
}

export default function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "brand",
  delta,
  menu,
  chart,
  featured = false,
}: {
  label: string;
  /** A formatted string, or a node (e.g. an animated number). */
  value: ReactNode;
  /** One quiet context line, shown in the footer ("Vs last month: …"). */
  sub?: string;
  icon?: LucideIcon;
  tone?: StatTone;
  /** A REAL period-over-period change; omit rather than invent one. */
  delta?: StatDelta;
  /** Real destinations only (reports, analytics…). Omit for no menu. */
  menu?: StatMenuLink[];
  /** Optional chart drawn along the bottom (use currentColor strokes). */
  chart?: ReactNode;
  /** The larger hero tile (CEO). */
  featured?: boolean;
}) {
  const footer = [delta?.note, sub].filter(Boolean).join(" · ");

  return (
    <Card
      className={cn(
        "@container relative min-w-0 overflow-hidden rounded-2xl border-0 shadow-theme-xs",
        TONE[tone],
      )}
    >
      <Pattern />

      <CardHeader className="relative z-10 min-h-0 flex-nowrap items-start border-0 px-4 pb-0 pt-4 sm:px-5 sm:pt-5">
        <CardTitle className="text-[0.9375rem] font-medium leading-snug text-current opacity-90">{label}</CardTitle>
        <CardToolbar className="shrink-0 gap-2">
          {Icon ? <Icon className="h-5 w-5 opacity-80" strokeWidth={2} aria-hidden /> : null}
          {menu && menu.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="dim"
                  size="sm"
                  mode="icon"
                  aria-label={`${label}: more`}
                  className="-me-1.5 text-current opacity-80 hover:bg-white/10 hover:text-current hover:opacity-100"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="bottom">
                {menu.map((m) => (
                  <DropdownMenuItem key={m.href} asChild>
                    <Link href={m.href}>
                      {m.icon ? <m.icon /> : null} {m.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </CardToolbar>
      </CardHeader>

      <CardContent className="relative z-10 flex flex-1 flex-col px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span
            className={cn(
              "num font-semibold leading-tight tracking-tight",
              // The number's size follows the TILE's width (the card is a size container), so
              // "UGX 78,200,000" shrinks to fit a narrow phone tile instead of being cut off,
              // and still reaches full size on a wide one. If it can't fit, it wraps.
              featured
                ? "break-words text-[length:clamp(1.25rem,calc((100cqw-2.5rem)/8),2.125rem)] leading-none"
                : "break-words text-[length:clamp(1.0625rem,calc((100cqw-2.5rem)/9.5),1.75rem)] leading-tight",
            )}
            title={typeof value === "string" ? value : undefined}
          >
            {value}
          </span>
          {delta ? (
            <Badge className="bg-white/20 font-semibold text-current" title={delta.note}>
              {delta.dir === "up" ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden />}
              <span className="num">{Math.abs(delta.pct)}%</span>
              <span className="sr-only">{delta.dir === "up" ? "up" : "down"} {delta.note}</span>
            </Badge>
          ) : null}
        </div>

        {footer ? (
          <p className="mt-3 border-t border-current/20 pt-2.5 text-[0.8125rem] opacity-85">{footer}</p>
        ) : null}

        {chart ? <div className="mt-auto pt-4">{chart}</div> : null}
      </CardContent>
    </Card>
  );
}
