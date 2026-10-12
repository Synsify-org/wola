import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";

/** Phone-only stacked list. Pair it with the page's desktop table, which
 *  gets `hidden sm:block`: below `sm` a wide table only scrolls sideways,
 *  which hides most of its columns; a stacked row shows the three things
 *  that matter (who, what, how much / what state) at a glance. */
export function MobileRowList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <ul className={"divide-y divide-rule border-t border-rule sm:hidden " + className}>{children}</ul>;
}

export function MobileRow({
  href,
  name,
  title,
  subtitle,
  value,
  valueNote,
  chip,
  actions,
}: {
  /** Whole row is a link when set (44px+ tap target, press feedback). */
  href?: string;
  /** Person shown as the avatar. Omit for rows that aren't about a person. */
  name?: string | null;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned primary figure, e.g. an amount. */
  value?: ReactNode;
  valueNote?: ReactNode;
  chip?: ReactNode;
  /** Extra controls under the row (Edit / Deactivate...). They live outside
   *  the link so a row is never a link nested inside a link. */
  actions?: ReactNode;
}) {
  const body = (
    <>
      {name !== undefined ? <Avatar name={name} size="sm" /> : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{title}</div>
        {subtitle ? <div className="truncate text-xs text-ink-soft">{subtitle}</div> : null}
      </div>
      {value !== undefined || chip ? (
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          {value !== undefined ? <span className="num text-sm font-medium text-ink">{value}</span> : null}
          {valueNote ? <span className="text-xs text-ink-faint">{valueNote}</span> : null}
          {chip}
        </div>
      ) : null}
      {href ? <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden /> : null}
    </>
  );

  return (
    <li>
      {href ? (
        <Link
          href={href}
          className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors active:bg-paper"
        >
          {body}
        </Link>
      ) : (
        <div className="flex min-h-14 items-center gap-3 px-4 py-3">{body}</div>
      )}
      {actions ? <div className="flex flex-wrap items-center gap-3 px-4 pb-3 pl-15">{actions}</div> : null}
    </li>
  );
}
