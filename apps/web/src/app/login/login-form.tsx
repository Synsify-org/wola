"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Building2, Eye, EyeOff, Landmark, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LoginState } from "./page";

// CSS-only entrance animation (tw-animate-css), not motion/react — this is
// the front door of the app and has to render reliably above everything
// else; a client-side animation library silently failing here is a much
// worse outcome than a slightly plainer fade-in.
const enter = "animate-in fade-in slide-in-from-bottom-2 duration-500";

// Mirrors the server-side caps in lib/auth.ts, so the browser stops input
// early; the server still enforces them.
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 256;

function Brand({ tenantName, light = false }: { tenantName: string | null; light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={
          "grid h-10 w-10 shrink-0 place-items-center rounded-xl " +
          (light ? "bg-white/15 backdrop-blur-sm" : "bg-brand text-brand-ink")
        }
      >
        <Landmark className="h-5 w-5" strokeWidth={2} aria-hidden />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-lg font-semibold tracking-tight">Wola</span>
        {tenantName ? (
          <span className={"block truncate text-xs " + (light ? "text-white/70" : "text-ink-soft")}>{tenantName}</span>
        ) : null}
      </span>
    </div>
  );
}

export default function LoginForm(props: {
  action: (prev: LoginState, formData: FormData) => Promise<LoginState>;
  tenantName: string | null;
  host: string | null;
}) {
  const { tenantName, host } = props;
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  // Controlled, so a failed attempt keeps the email (React resets an
  // uncontrolled form after its action runs). The password is deliberately
  // NOT kept: it clears after every failed attempt.
  const [email, setEmail] = useState("");
  const [state, formAction, pending] = useActionState<LoginState, FormData>(props.action, {});

  useEffect(() => {
    if (state.ok) {
      router.replace("/");
      router.refresh();
    }
  }, [state.ok, router]);

  const onPasswordKey = (e: React.KeyboardEvent<HTMLInputElement>) =>
    setCapsLock(e.getModifierState?.("CapsLock") ?? false);

  return (
    <div className="grid min-h-dvh w-full bg-paper lg:grid-cols-2">
      {/* Brand panel (lg+): tenant brand ramp, same treatment as the
          dashboard banner — our own tokens, no external image. */}
      <aside className="relative hidden p-4 lg:block" aria-hidden>
        <div
          className="relative flex h-full flex-col justify-between overflow-hidden rounded-3xl p-10 text-white shadow-theme-lg"
          style={{
            background:
              "radial-gradient(120% 120% at 100% 0%, color-mix(in oklch, var(--color-brand-500) 70%, transparent) 0%, transparent 55%), linear-gradient(145deg, var(--color-brand-900), var(--color-brand-700))",
          }}
        >
          <svg
            className="pointer-events-none absolute -right-32 -top-32 h-[28rem] w-[28rem] text-white/10"
            viewBox="0 0 320 320"
            fill="none"
          >
            {[150, 122, 94, 66, 38].map((r) => (
              <circle key={r} cx="160" cy="160" r={r} stroke="currentColor" strokeWidth="1" />
            ))}
          </svg>

          <div className="relative">
            <Brand tenantName={tenantName} light />
          </div>

          <div className="relative max-w-sm">
            <p className="text-3xl font-semibold leading-tight tracking-tight text-balance">
              Lending, built on the payroll you already run.
            </p>
            <p className="mt-4 text-sm text-white/75">Staff loan management for East African employers.</p>
          </div>

          <p className="relative flex items-center gap-2 text-xs text-white/65">
            <Lock className="h-3.5 w-3.5" />
            Protected environment. Sign-in attempts are logged.
          </p>
        </div>
      </aside>

      {/* Form: centred on both axes at every size. */}
      <main className="flex items-center justify-center px-4 py-10 sm:px-6">
        <div className={"w-full max-w-[26rem] " + enter}>
          <div className="mb-8 flex justify-center lg:hidden">
            <Brand tenantName={tenantName} />
          </div>

          <div className="rounded-2xl border border-rule bg-surface p-6 shadow-theme-sm sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[1.75rem]">Sign in</h1>
            <p className="mt-1.5 text-sm text-ink-soft">Welcome back. Use your work email to continue.</p>

            {/* Which company is this? Shown before any password is typed —
                a look-alike phishing page can't show the real address. */}
            {tenantName ? (
              <div className="mt-5 flex items-center gap-3 rounded-xl border border-rule bg-paper px-3.5 py-2.5">
                <Building2 className="h-4.5 w-4.5 shrink-0 text-brand" aria-hidden />
                <div className="min-w-0 text-sm leading-tight">
                  <div className="truncate font-medium text-ink">{tenantName}</div>
                  {host ? <div className="truncate text-xs text-ink-soft">{host}</div> : null}
                </div>
              </div>
            ) : null}

            {state.error ? (
              <div
                role="alert"
                className="mt-5 flex items-start gap-2.5 rounded-xl border border-error-200 bg-rejected-wash px-3.5 py-3 text-sm text-rejected"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{state.error}</span>
              </div>
            ) : null}

            <form action={formAction} className="mt-6 flex flex-col gap-5">
              <div className="space-y-1.5">
                <Label htmlFor="email">Work email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  inputMode="email"
                  maxLength={MAX_EMAIL_LENGTH}
                  placeholder="you@company.com"
                  autoFocus
                  required
                  className="h-11"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link href="/forgot-password" className="text-xs font-medium text-brand hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    maxLength={MAX_PASSWORD_LENGTH}
                    onKeyDown={onPasswordKey}
                    onKeyUp={onPasswordKey}
                    onBlur={() => setCapsLock(false)}
                    aria-describedby={capsLock ? "caps-lock" : undefined}
                    required
                    className="h-11 pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-ink-faint transition-colors hover:text-ink-soft focus-visible:text-ink"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                  </button>
                </div>
                {capsLock ? (
                  <p id="caps-lock" className="text-xs font-medium text-awaiting" role="status">
                    Caps Lock is on.
                  </p>
                ) : null}
              </div>

              <label htmlFor="remember" className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-soft">
                <input
                  id="remember"
                  name="remember"
                  type="checkbox"
                  value="1"
                  className="size-[18px] rounded border-rule accent-[var(--color-brand)]"
                />
                Keep me signed in for 30 days
              </label>

              <Button type="submit" disabled={pending} className="h-11 w-full text-sm font-semibold">
                {pending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Signing in…
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
          </div>

          <p className="mt-6 text-center text-xs text-ink-faint">
            No account? Access is provisioned by your HR team.
          </p>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-ink-faint lg:hidden">
            <Lock className="h-3 w-3" aria-hidden />
            Protected environment. Sign-in attempts are logged.
          </p>
        </div>
      </main>
    </div>
  );
}
