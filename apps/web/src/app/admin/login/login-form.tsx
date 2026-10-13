"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SuperLoginState } from "./page";

type Action = (prev: SuperLoginState, formData: FormData) => Promise<SuperLoginState>;

// Two steps: password, then (once the server can verify codes) a code from the
// authenticator app. One piece of state decides which step shows.
export default function SuperLoginForm(props: { action: Action; verifyAction: Action }) {
  const router = useRouter();
  const [challenge, setChallenge] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(action: Action, formData: FormData) {
    start(async () => {
      const r = await action({}, formData);
      setError(r.error ?? null);
      setChallenge(r.mfa?.challenge ?? null);
      if (r.ok) {
        router.replace("/admin");
        router.refresh();
      }
    });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-brand-ink">
            <Landmark className="h-5 w-5" strokeWidth={2} />
          </span>
          <div>
            <div className="text-base font-bold leading-tight text-ink">Wola</div>
            <div className="text-xs text-ink-soft">Platform admin</div>
          </div>
        </div>

        <h1 className="text-xl font-semibold text-ink">{challenge ? "Two-step check" : "Sign in"}</h1>
        <p className="mt-1 text-sm text-ink-soft">{challenge ? "Enter the code from your authenticator app." : "For Wola operators only."}</p>

        {challenge ? (
          <form action={(fd) => run(props.verifyAction, fd)} className="mt-6 space-y-4">
            <input type="hidden" name="challenge" value={challenge} />
            {error ? <div role="alert" className="rounded-md bg-rejected-wash px-3 py-2 text-sm text-rejected">{error}</div> : null}
            <div className="space-y-1.5">
              <Label htmlFor="code">Code</Label>
              <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required className="tracking-widest" />
              <p className="text-xs text-ink-soft">Lost your phone? Enter one of your recovery codes instead.</p>
            </div>
            <Button type="submit" disabled={pending} className="w-full">{pending ? "Checking…" : "Verify and sign in"}</Button>
          </form>
        ) : (
          <form action={(fd) => run(props.action, fd)} className="mt-6 space-y-4">
            {error ? <div role="alert" className="rounded-md bg-rejected-wash px-3 py-2 text-sm text-rejected">{error}</div> : null}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            <Button type="submit" disabled={pending} className="w-full">{pending ? "Signing in…" : "Sign in"}</Button>
          </form>
        )}
      </div>
    </main>
  );
}
