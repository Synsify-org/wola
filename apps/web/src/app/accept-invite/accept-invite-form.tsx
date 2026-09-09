"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AcceptInviteState } from "./page";

const roleLabel = (r: string) =>
  r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function AcceptInviteForm(props: {
  action: (prev: AcceptInviteState, formData: FormData) => Promise<AcceptInviteState>;
  token: string;
  invite: { email: string; role: string; tenantName: string; needsPassword: boolean } | null;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<AcceptInviteState, FormData>(props.action, {});

  useEffect(() => {
    if (state.ok) {
      router.replace("/");
      router.refresh();
    }
  }, [state.ok, router]);

  if (!props.invite) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper px-6 py-12">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-xl font-semibold text-ink">Invitation not found</h1>
          <p className="mt-2 text-sm text-ink-soft">
            This invitation link is invalid, already used, or has expired. Ask whoever invited you to send a new one.
          </p>
          <Link href="/login" className="mt-4 inline-block text-sm text-brand hover:underline">
            Go to sign in
          </Link>
        </div>
      </main>
    );
  }

  const { email, role, tenantName, needsPassword } = props.invite;

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6 py-12">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold text-ink">Join {tenantName}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          You&apos;ve been invited as <span className="font-medium text-ink">{roleLabel(role)}</span>, using{" "}
          <span className="font-medium text-ink">{email}</span>.
        </p>

        {state.ok ? (
          <div role="status" className="mt-6 rounded-md bg-approved-wash px-3 py-2 text-sm text-approved">
            You&apos;re in. Taking you to your dashboard…
          </div>
        ) : (
          <form action={formAction} className="mt-6 space-y-4">
            <input type="hidden" name="token" value={props.token} />

            {state.error ? (
              <div role="alert" className="rounded-md bg-rejected-wash px-3 py-2 text-sm text-rejected">
                {state.error}
              </div>
            ) : null}

            {needsPassword ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Choose a password</Label>
                  <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
                </div>
              </>
            ) : (
              <p className="text-sm text-ink-soft">
                {email} already has a Wola account — accept below to add {tenantName} to it. Your existing password still works.
              </p>
            )}

            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Joining…" : "Accept invitation"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
