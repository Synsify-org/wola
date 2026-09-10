"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SuperLoginState } from "./page";

export default function SuperLoginForm(props: {
  action: (prev: SuperLoginState, formData: FormData) => Promise<SuperLoginState>;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<SuperLoginState, FormData>(props.action, {});

  useEffect(() => {
    if (state.ok) {
      router.replace("/admin");
      router.refresh();
    }
  }, [state.ok, router]);

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

        <h1 className="text-xl font-semibold text-ink">Sign in</h1>
        <p className="mt-1 text-sm text-ink-soft">For Wola operators only.</p>

        <form action={formAction} className="mt-6 space-y-4">
          {state.error ? (
            <div role="alert" className="rounded-md bg-rejected-wash px-3 py-2 text-sm text-rejected">
              {state.error}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </main>
  );
}
