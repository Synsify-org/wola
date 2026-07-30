"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LoginState } from "./page";

export default function LoginForm(props: {
  action: (prev: LoginState, formData: FormData) => Promise<LoginState>;
}) {
  const router = useRouter();
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
    <main className="grid min-h-screen lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-brand p-10 text-brand-ink lg:flex">
        <div className="text-2xl font-bold tracking-tight">Wola</div>
        <div className="max-w-sm">
          <p className="text-3xl font-semibold leading-tight">
            Lending, built on the payroll you already run.
          </p>
          <p className="mt-4 text-sm">
            Staff loan management for East African employers.
          </p>
        </div>
        <div className="text-xs">Protected environment. Access is logged.</div>
      </aside>

      <section className="flex items-center justify-center bg-paper px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-semibold text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Enter your work email to continue.
          </p>

          {state.error ? (
            <div
              role="alert"
              className="mt-5 rounded-md bg-rejected-wash px-3 py-2 text-sm text-rejected"
            >
              {state.error}
            </div>
          ) : null}

          <form action={formAction} className="mt-6 space-y-4">
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
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="password"
                required
              />
            </div>

            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Signing in..." : "Sign in"}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-ink-faint">
            Access is provisioned by your HR team.
          </p>
        </div>
      </section>
    </main>
  );
}
