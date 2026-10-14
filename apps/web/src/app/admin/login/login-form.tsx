"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, ShieldCheck } from "lucide-react";
import AuthShell from "@/components/auth/auth-shell";
import { AuthAlert, AuthButton, AuthField, AuthPasswordField } from "@/components/auth/auth-fields";
import { setFlash } from "@/lib/flash";
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
      if (r.error) toast.error("Couldn't sign you in", { id: "signin-error", description: r.error });
      else if (r.mfa) toast.info("Password accepted", { id: "signin-mfa", description: "Now enter the code from your authenticator app." });
      if (r.ok) {
        // The console shows "Signed in" on arrival (components/auth-flash.tsx).
        setFlash("signed-in");
        router.replace("/admin");
        router.refresh();
      }
    });
  }

  return (
    <AuthShell
      audience="platform"
      title={challenge ? "Two-step check" : "Platform sign in"}
      description={challenge ? "Enter the code from your authenticator app." : "For Wola operators only."}
    >
      <div className="space-y-5">
        {error ? (
          <AuthAlert>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </AuthAlert>
        ) : null}

        {challenge ? (
          <form action={(fd) => run(props.verifyAction, fd)} className="flex flex-col gap-5">
            <input type="hidden" name="challenge" value={challenge} />
            <div className="flex items-start gap-3 rounded-2xl border border-rule bg-ink/[0.03] px-4 py-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
              <p className="text-sm text-ink-soft">Your password is right. One more step.</p>
            </div>
            <AuthField
              label="Code"
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123 456"
              autoFocus
              required
              hint="Lost your phone? Enter one of your recovery codes instead."
              className="h-12 w-full min-w-0 rounded-2xl bg-transparent px-4 text-center text-lg tracking-widest text-ink outline-none placeholder:text-ink-faint"
            />
            <AuthButton type="submit" pending={pending} pendingLabel="Checking…">Verify and sign in</AuthButton>
          </form>
        ) : (
          <form action={(fd) => run(props.action, fd)} className="flex flex-col gap-5">
            <AuthField label="Email" id="email" name="email" type="email" autoComplete="email" placeholder="you@wola.africa" autoFocus required />
            <AuthPasswordField label="Password" id="password" name="password" autoComplete="current-password" placeholder="Enter your password" required />
            <AuthButton type="submit" pending={pending} pendingLabel="Signing in…">Sign in</AuthButton>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
