// Small building blocks shared by the platform console's pages.
import type { ReactNode } from "react";

/** A titled card. `action` sits at the right of the title (a link, a count). */
export function Panel({ title, action, children, className = "" }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-rule bg-surface shadow-theme-xs ${className}`}>
      <header className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3.5">
        <h2 className="text-[0.9375rem] font-semibold text-ink">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-ink-soft">{children}</p>;
}

const STATUS_CHIP: Record<string, string> = {
  active: "chip chip--approved",
  suspended: "chip chip--rejected",
  disabled: "chip chip--rejected",
};
/** An organisation's or operator's status as a chip. */
export function StatusChip({ status }: { status: string }) {
  return <span className={STATUS_CHIP[status] ?? "chip chip--awaiting"}>{status}</span>;
}

/** "5 min ago", "3 days ago", "12 Oct": for a recent moment. */
export { timeAgo } from "@/lib/time-ago";
