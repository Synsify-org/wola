"use client";
import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ForgotPasswordState } from "./page";

export default function ForgotPasswordForm(props: {
  action: (prev: ForgotPasswordState, formData: FormData) => Promise<ForgotPasswordState>;
}) {
  const [state, formAction, pending] = useActionState<ForgotPasswordState, FormData>(props.action, {});

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6 py-12">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold text-ink">Reset your password</h1>
        <p className="mt-1 text-sm text-ink-soft">Enter your work email and we'll send a reset link.</p>

        {state.submitted ? (
          <div role="status" className="mt-6 rounded-md bg-approved-wash px-3 py-2 text-sm text-approved">
            If that email has an account here, we've sent a reset link. It expires in 1 hour.
          </div>
        ) : (
          <form action={formAction} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
            </div>
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-ink-faint">
          <Link href="/login" className="text-brand hover:underline">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}
