"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ResetPasswordState } from "./page";

export default function ResetPasswordForm(props: {
  action: (prev: ResetPasswordState, formData: FormData) => Promise<ResetPasswordState>;
  token: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ResetPasswordState, FormData>(props.action, {});

  useEffect(() => {
    if (state.ok) {
      const t = setTimeout(() => router.replace("/login"), 1500);
      return () => clearTimeout(t);
    }
  }, [state.ok, router]);

  if (!props.token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper px-6 py-12">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-xl font-semibold text-ink">Missing reset link</h1>
          <p className="mt-2 text-sm text-ink-soft">
            This page needs a reset token. Use the link from your email, or{" "}
            <Link href="/forgot-password" className="text-brand hover:underline">request a new one</Link>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6 py-12">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold text-ink">Set a new password</h1>
        <p className="mt-1 text-sm text-ink-soft">Choose a new password for your account.</p>

        {state.ok ? (
          <div role="status" className="mt-6 rounded-md bg-approved-wash px-3 py-2 text-sm text-approved">
            Password updated. Redirecting to sign in…
          </div>
        ) : (
          <form action={formAction} className="mt-6 space-y-4">
            <input type="hidden" name="token" value={props.token} />

            {state.error ? (
              <div role="alert" className="rounded-md bg-rejected-wash px-3 py-2 text-sm text-rejected">
                {state.error}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="password">New password</Label>
              <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
            </div>

            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Saving…" : "Set new password"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
