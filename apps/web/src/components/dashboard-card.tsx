import type { ReactNode } from "react";

// Shared card shell: title + optional top-right action + content + optional
// footer. One place to change the "card" look on every dashboard.
//
//   className — grid placement from the caller (e.g. "lg:col-span-2").
//   flush     — drop body padding so a table can run edge to edge under the
//               title, the way the reference layout's "Top posts" card does.
export default function DashboardCard({
  title,
  action,
  footer,
  className = "",
  flush = false,
  children,
}: {
  title: string;
  action?: ReactNode;
  footer?: ReactNode;
  className?: string;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={
        "flex h-full min-w-0 flex-col rounded-2xl border border-rule bg-surface shadow-theme-xs " +
        (flush ? "overflow-hidden " : "p-5 sm:p-6 ") +
        className
      }
    >
      <div className={"flex items-center justify-between gap-3 " + (flush ? "px-5 pb-3 pt-5 sm:px-6 sm:pt-6" : "mb-5")}>
        <h2 className="text-[1.0625rem] font-semibold text-ink">{title}</h2>
        {action}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
      {footer ? <div className={flush ? "px-5 pb-5 sm:px-6" : "mt-4"}>{footer}</div> : null}
    </section>
  );
}
