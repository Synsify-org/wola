// apps/web/src/components/dashboard-welcome-banner.tsx
// The Dashboard route's banner, directly under the topbar: greeting, title,
// the role's one question, the role's primary actions — and one LIVE figure
// (the "highlight") that tells this person what needs them right now.
// Compact on purpose: a banner that only says hello costs a fifth of the
// first screen, so this one carries real, actionable information.
//
// Colour comes from the tenant brand ramp (900 → 700), so it re-themes per
// tenant; theme.ts derives the dark steps, keeping white text legible even
// for a light brand colour.
import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

export type HeaderAction = { href: string; label: string; icon?: LucideIcon; primary?: boolean };
/** attention = something is waiting on this person; calm = all clear / info. */
export type BannerHighlight = { label: string; href?: string; tone: "attention" | "calm" };

function Highlight({ highlight }: { highlight: BannerHighlight }) {
  const attention = highlight.tone === "attention";
  const body = (
    <>
      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
        {attention ? (
          <span className="absolute inline-flex h-full w-full rounded-full bg-accent-500 opacity-75 motion-safe:animate-ping" />
        ) : null}
        <span className={"relative inline-flex h-2.5 w-2.5 rounded-full " + (attention ? "bg-accent-500" : "bg-success-100")} />
      </span>
      <span className="min-w-0">{highlight.label}</span>
      {highlight.href ? <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" /> : null}
    </>
  );
  const cls =
    "group inline-flex max-w-full items-center gap-2.5 rounded-full bg-white/10 px-3.5 py-2 text-sm font-medium text-white ring-1 ring-white/15 backdrop-blur-sm";
  return highlight.href ? (
    <Link href={highlight.href} className={cls + " transition-colors hover:bg-white/15"}>
      {body}
    </Link>
  ) : (
    <span className={cls}>{body}</span>
  );
}

export default function DashboardWelcomeBanner({
  name,
  tenantName,
  subtitle,
  actions = [],
  highlight,
}: {
  name: string;
  tenantName: string;
  subtitle: string;
  actions?: HeaderAction[];
  highlight?: BannerHighlight;
}) {
  const firstName = name.split(" ")[0];

  return (
    <section
      aria-label="Welcome"
      className="relative mb-6 overflow-hidden rounded-2xl p-5 text-white shadow-theme-sm animate-in fade-in slide-in-from-bottom-1 duration-500 sm:p-7 md:mb-8"
      style={{
        background:
          "radial-gradient(120% 160% at 100% 0%, color-mix(in oklch, var(--color-brand-500) 70%, transparent) 0%, transparent 55%), linear-gradient(135deg, var(--color-brand-900), var(--color-brand-700))",
      }}
    >
      {/* Decorative rings, top-right — quiet texture, never behind the text. */}
      <svg
        className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 text-white/10 sm:-right-16"
        viewBox="0 0 320 320"
        fill="none"
        aria-hidden
      >
        {[150, 118, 86, 54].map((r) => (
          <circle key={r} cx="160" cy="160" r={r} stroke="currentColor" strokeWidth="1" />
        ))}
      </svg>

      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-white/70">
            {greeting()}, {firstName} &middot; {tenantName}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Dashboard</h1>
          <p className="mt-1 max-w-xl text-sm text-white/75 text-pretty">{subtitle}</p>
          {highlight ? (
            <div className="mt-4">
              <Highlight highlight={highlight} />
            </div>
          ) : null}
        </div>

        {actions.length > 0 ? (
          <div className="flex shrink-0 flex-wrap gap-2.5">
            {actions.map(({ href, label, icon: Icon, primary }) => (
              <Link
                key={href}
                href={href}
                className={
                  "inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold transition-all duration-150 active:scale-[0.97] " +
                  (primary
                    ? "bg-white text-brand-800 shadow-theme-xs hover:bg-brand-25"
                    : "bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/15")
                }
              >
                {Icon ? <Icon className="h-4 w-4" strokeWidth={2} aria-hidden /> : null}
                {label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
