import Link from "next/link";

/** Overview | Rejections, shown on every role's dashboard. A plain server
 *  component driven by ?view= so the tab is linkable and survives a refresh. */
export default function DashboardTabs({
  active,
  rejectionCount,
}: {
  active: "overview" | "rejections";
  rejectionCount: number;
}) {
  const tab = (key: "overview" | "rejections", label: string, href: string, count?: number) => {
    const on = active === key;
    return (
      <Link
        key={key}
        href={href}
        scroll={false}
        aria-current={on ? "page" : undefined}
        className={
          "relative inline-flex items-center gap-2 px-1 pb-3 text-sm font-medium transition-colors " +
          (on ? "text-brand" : "text-ink-soft hover:text-ink")
        }
      >
        {label}
        {count !== undefined && count > 0 ? (
          <span
            className={
              "num rounded-full px-2 py-0.5 text-xs font-semibold " +
              (on ? "bg-brand-50 text-brand-700" : "bg-rule text-ink-soft")
            }
          >
            {count}
          </span>
        ) : null}
        {on ? <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand" aria-hidden /> : null}
      </Link>
    );
  };

  return (
    <nav aria-label="Dashboard views" className="no-print mb-4 flex items-center gap-6 border-b border-rule xl:mb-5">
      {tab("overview", "Overview", "/")}
      {tab("rejections", "Rejections", "/?view=rejections", rejectionCount)}
    </nav>
  );
}
