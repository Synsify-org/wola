import type { ReactNode } from "react";

// Shared card shell: title + optional top-right action + content + optional
// footer (e.g. a sparkline strip). Consolidates the border/shadow/title
// treatment that ProductBars, PipelinePanel, and RecentActivity each used to
// hand-roll separately — one place to change the "card" look everywhere.
export default function DashboardCard({
  title,
  action,
  footer,
  children,
}: {
  title: string;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-rule bg-surface p-5 shadow-theme-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="caps">{title}</div>
        {action}
      </div>
      {children}
      {footer ? <div className="mt-4">{footer}</div> : null}
    </div>
  );
}
