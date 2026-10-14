"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { AlertCircle, Building2, ShieldCheck } from "lucide-react";
import AuthShell from "@/components/auth/auth-shell";
import { AuthAlert, AuthButton, AuthField, AuthPasswordField } from "@/components/auth/auth-fields";
import { setFlash } from "@/lib/flash";
import type { LoginState } from "./page";

// Mirrors the server-side caps in lib/auth.ts, so the browser stops input
// early; the server still enforces them.
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 256;

export default function LoginForm(props: {
  action: (prev: LoginState, formData: FormData) => Promise<LoginState>;
  /** Second step for people with two-step sign-in on. */
  verifyAction: (prev: LoginState, formData: FormData) => Promise<LoginState>;
  tenantName: string | null;
  host: string | null;
}) {
  const { tenantName, host } = props;
  const router = useRouter();
  // Controlled, so a failed attempt keeps the email (React resets an
  // uncontrolled form after its action runs). The password is deliberately
  // NOT kept: it clears after every failed attempt.
  const [email, setEmail] = useState("");
  const [state, formAction, pending] = useActionState<LoginState, FormData>(props.action, {});
  const [vState, verifyFormAction, verifying] = useActionState<LoginState, FormData>(props.verifyAction, {});
  // The challenge from the password step. Set when the password was right and
  // two-step sign-in is on; cleared when it can no longer be used (too many
  // wrong codes, expired, "use a different account").
  const [challenge, setChallenge] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Feedback: an inline message stays on the form (it is what a screen reader and a
  // slow reader need); a toast also pops up so a failed attempt can't go unnoticed.
  useEffect(() => {
    setNotice(state.error ?? null);
    if (state.error) toast.error("Couldn't sign you in", { id: "signin-error", description: state.error });
    if (state.mfa) {
      setChallenge(state.mfa.challenge);
      toast.info("Password accepted", { id: "signin-mfa", description: "Now enter the code from your authenticator app." });
    }
  }, [state]);

  useEffect(() => {
    if (vState.mfa) { setChallenge(vState.mfa.challenge); setNotice(vState.error ?? null); }
    else if (vState.error) { setChallenge(null); setNotice(vState.error); }
    if (vState.error) toast.error("That didn't work", { id: "signin-error", description: vState.error });
  }, [vState]);

  useEffect(() => {
    if (state.ok || vState.ok) {
      // The next page shows "Signed in. Welcome back, …" (see components/auth-flash.tsx).
      setFlash("signed-in");
      router.replace("/");
      router.refresh();
    }
  }, [state.ok, vState.ok, router]);

  return (
    <AuthShell
      audience="staff"
      tenantName={tenantName}
      title="Sign in"
      description="Welcome back. Use your work email to continue."
      footer={<p>No account? Access is provisioned by your HR team.</p>}
    >
      <div className="space-y-5">
        {/* Which company is this? Shown before any password is typed:
            a look-alike phishing page can't show the real address. */}
        {tenantName ? (
          <div className="flex items-center gap-3 rounded-2xl border border-rule bg-ink/[0.03] px-4 py-3">
            <Building2 className="h-5 w-5 shrink-0 text-brand" aria-hidden />
            <div className="min-w-0 text-sm leading-tight">
              <div className="truncate font-medium text-ink">{tenantName}</div>
              {host ? <div className="truncate text-xs text-ink-soft">{host}</div> : null}
            </div>
          </div>
        ) : null}

        {notice ? (
          <AuthAlert>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{notice}</span>
          </AuthAlert>
        ) : null}

        {challenge ? (
          <form action={verifyFormAction} className="flex flex-col gap-5">
            <input type="hidden" name="challenge" value={challenge} />
            <div className="flex items-start gap-3 rounded-2xl border border-rule bg-ink/[0.03] px-4 py-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
              <p className="text-sm text-ink-soft">
                Your password is right. Now enter the 6-digit code from your authenticator app.
              </p>
            </div>
            <AuthField
              label="Code"
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={24}
              placeholder="123 456"
              autoFocus
              required
              hint="Lost your phone? Enter one of your recovery codes instead."
              className="h-12 w-full min-w-0 rounded-2xl bg-transparent px-4 text-center text-lg tracking-widest text-ink outline-none placeholder:text-ink-faint"
            />
            <AuthButton type="submit" pending={verifying} pendingLabel="Checking…">Verify and sign in</AuthButton>
            <button
              type="button"
              onClick={() => { setChallenge(null); setNotice(null); }}
              className="text-sm font-medium text-ink-soft hover:text-ink"
            >
              Use a different account
            </button>
          </form>
        ) : (
          <form action={formAction} className="flex flex-col gap-5">
            <AuthField
              label="Work email"
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
            />
            <AuthPasswordField
              label="Password"
              id="password"
              name="password"
              autoComplete="current-password"
              maxLength={MAX_PASSWORD_LENGTH}
              placeholder="Enter your password"
              required
              aside={<Link href="/forgot-password" className="text-xs font-medium text-brand hover:underline">Forgot password?</Link>}
            />
            <label htmlFor="remember" className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-soft">
              <input id="remember" name="remember" type="checkbox" value="1" className="size-[18px] rounded border-rule accent-[var(--color-brand)]" />
              Keep me signed in for 30 days
            </label>
            <AuthButton type="submit" pending={pending} pendingLabel="Signing in…">Sign in</AuthButton>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
