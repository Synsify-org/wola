"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LoginState } from "./page";

// CSS-only entrance animation (tw-animate-css), not motion/react — this is
// the front door of the app and has to render reliably above everything
// else; a client-side animation library silently failing here is a much
// worse outcome than a slightly plainer fade-in.
const enter = "animate-in fade-in slide-in-from-bottom-2 duration-500";

export default function LoginForm(props: {
  action: (prev: LoginState, formData: FormData) => Promise<LoginState>;
}) {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    props.action,
    {},
  );

  useEffect(() => {
    if (state.ok) {
      router.replace("/");
      router.refresh();
    }
  }, [state.ok, router]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-paper lg:flex-row">
      {/* Left brand panel — our own tokens, no external image dependency. */}
      <div className="relative hidden w-full flex-col p-4 lg:flex lg:min-h-screen lg:w-1/2">
        <div
          className="relative flex h-full w-full flex-col justify-between overflow-hidden rounded-[24px] p-10 text-brand-ink shadow-theme-lg"
          style={{ background: "linear-gradient(135deg, var(--color-brand-800), var(--color-brand-600) 60%, var(--color-brand-500))" }}
        >
          <div
            className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full opacity-40 blur-3xl"
            style={{ background: "var(--color-accent-500)" }}
          />
          <div
            className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full opacity-30 blur-3xl"
            style={{ background: "var(--color-brand-300)" }}
          />

          <div className="relative z-10 flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 backdrop-blur-sm">
              <Landmark className="h-5 w-5" strokeWidth={2} />
            </span>
            <span className="text-xl font-bold tracking-tight">Wola</span>
          </div>

          <div className="relative z-10 max-w-sm">
            <p className="text-3xl font-semibold leading-tight">
              Lending, built on the payroll you already run.
            </p>
            <p className="mt-4 text-sm text-brand-ink/80">
              Staff loan management for East African employers.
            </p>
          </div>

          <div className="relative z-10 text-xs text-brand-ink/70">Protected environment. Access is logged.</div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex w-full flex-col items-center justify-center p-6 sm:p-12 lg:w-1/2">
        <div className={"w-full max-w-[400px] " + enter}>
          <div className="mb-10">
            <h1 className="mb-3 text-4xl font-semibold leading-[1.05] tracking-tight text-ink">
              Welcome back
            </h1>
            <p className="text-sm text-ink-soft">
              Enter your work email to continue.
            </p>
          </div>

          {state.error ? (
            <div role="alert" className="mb-5 rounded-md bg-rejected-wash px-3 py-2 text-sm text-rejected">
              {state.error}
            </div>
          ) : null}

          <form action={formAction} className="flex flex-col gap-5">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                required
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
                  placeholder="password"
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-ink-faint transition-colors hover:text-ink-soft"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <input
                id="remember"
                name="remember"
                type="checkbox"
                value="1"
                className="size-[18px] rounded border-rule text-brand accent-[var(--color-brand)]"
              />
              <label htmlFor="remember" className="text-sm text-ink-soft">
                Keep me signed in for 30 days
              </label>
            </div>

            <div>
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? "Signing in…" : "Sign in"}
              </Button>
            </div>
          </form>

          <p className="mt-8 text-center text-xs text-ink-faint">
            Access is provisioned by your HR team.
          </p>
        </div>
      </div>
    </div>
  );
}
