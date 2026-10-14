// The frame for every sign-in screen: the form on the left, a brand panel on the right
// (hidden on phones, where the form is the whole screen).
//
// Used by the staff login and the platform console login, so both look and behave the
// same. The panel is built from the tenant's brand tokens and inline SVG: no external
// image to load, nothing to break, and a white-labelled organisation still looks like
// itself. The three cards are real statements about the product, not testimonials.
import type { ReactNode } from "react";
import { Building2, KeyRound, Landmark, Lock, ScrollText, type LucideIcon } from "lucide-react";
import AuthFlash from "@/components/auth-flash";

type Point = { icon: LucideIcon; title: string; text: string };

const AUDIENCES = {
  staff: {
    headline: "Lending, built on the payroll you already run.",
    sub: "Staff loan management for East African employers.",
    points: [
      { icon: ScrollText, title: "Every deduction accounted for", text: "Each repayment ties back to a ledger entry: who, when, how much." },
      { icon: KeyRound, title: "Two-step sign-in", text: "Your organisation can require it for finance and admin roles." },
      { icon: Building2, title: "Your data stays yours", text: "Each organisation is separated by the database itself, not just by the app." },
    ] satisfies Point[],
  },
  platform: {
    headline: "The Wola platform console.",
    sub: "For Wola operators. Every organisation, in one place.",
    points: [
      { icon: Building2, title: "All organisations", text: "Totals and activity across everyone on the platform." },
      { icon: KeyRound, title: "A second step, always", text: "After your password, a code from your authenticator app." },
      { icon: ScrollText, title: "Attempts are logged", text: "Failed sign-ins are rate-limited and recorded." },
    ] satisfies Point[],
  },
} as const;

const enter = "animate-in fade-in slide-in-from-bottom-2 fill-mode-both motion-reduce:animate-none";

export function AuthBrand({ tenantName, light = false }: { tenantName?: string | null; light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={"grid h-10 w-10 shrink-0 place-items-center rounded-xl " + (light ? "bg-white/15 backdrop-blur-sm" : "bg-brand text-brand-ink")}>
        <Landmark className="h-5 w-5" strokeWidth={2} aria-hidden />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-lg font-semibold tracking-tight">Wola</span>
        {tenantName ? <span className={"block truncate text-xs " + (light ? "text-white/70" : "text-ink-soft")}>{tenantName}</span> : null}
      </span>
    </div>
  );
}

export default function AuthShell({
  audience = "staff", tenantName, title, description, children, footer,
}: {
  audience?: keyof typeof AUDIENCES;
  tenantName?: string | null;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const a = AUDIENCES[audience];
  return (
    <div className="grid grid-cols-1 min-h-dvh w-full bg-paper lg:grid-cols-2">
      <AuthFlash />

      <main className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[26rem]">
          <div className={`mb-10 ${enter} duration-500`}>
            <AuthBrand tenantName={tenantName} />
          </div>
          <h1 className={`text-3xl font-semibold tracking-tight text-ink sm:text-4xl ${enter} delay-100 duration-500`}>{title}</h1>
          {description ? <p className={`mt-2 text-ink-soft ${enter} delay-200 duration-500`}>{description}</p> : null}
          <div className={`mt-8 ${enter} delay-300 duration-500`}>{children}</div>
          {footer ? <div className={`mt-8 text-center text-xs text-ink-faint ${enter} delay-500 duration-500`}>{footer}</div> : null}
        </div>
      </main>

      <aside className="relative hidden p-4 lg:block" aria-hidden>
        <div
          className="relative flex h-full flex-col justify-between overflow-hidden rounded-3xl p-10 text-white shadow-theme-lg"
          style={{
            background:
              "radial-gradient(120% 120% at 100% 0%, color-mix(in oklch, var(--color-brand-500) 70%, transparent) 0%, transparent 55%), linear-gradient(145deg, var(--color-brand-900), var(--color-brand-700))",
          }}
        >
          <svg className="pointer-events-none absolute -right-32 -top-32 h-[30rem] w-[30rem] text-white/10" viewBox="0 0 320 320" fill="none">
            {[150, 122, 94, 66, 38].map((r) => <circle key={r} cx="160" cy="160" r={r} stroke="currentColor" strokeWidth="1" />)}
          </svg>
          <svg className="pointer-events-none absolute -bottom-24 -left-20 h-80 w-80 text-white/[0.07]" viewBox="0 0 200 200" fill="currentColor">
            <circle cx="100" cy="100" r="90" /><circle cx="150" cy="60" r="40" />
          </svg>

          <div className={`relative max-w-md ${enter} delay-300 duration-700`}>
            <p className="text-4xl font-semibold leading-[1.1] tracking-tight text-balance">{a.headline}</p>
            <p className="mt-4 text-sm text-white/75">{a.sub}</p>
          </div>

          <div className="relative space-y-3">
            {a.points.map((p, i) => (
              <div
                key={p.title}
                className={`flex items-start gap-3.5 rounded-3xl border border-white/15 bg-white/10 p-4 backdrop-blur-xl ${enter} duration-700`}
                style={{ animationDelay: `${600 + i * 150}ms` }}
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white/15"><p.icon className="h-5 w-5" /></span>
                <div className="text-sm leading-snug">
                  <p className="font-medium">{p.title}</p>
                  <p className="mt-0.5 text-white/75">{p.text}</p>
                </div>
              </div>
            ))}
            <p className="flex items-center gap-2 pt-2 text-xs text-white/65">
              <Lock className="h-3.5 w-3.5" /> Protected environment. Sign-in attempts are logged.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

