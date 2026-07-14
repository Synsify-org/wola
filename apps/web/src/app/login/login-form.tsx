"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { LoginState } from "./page";

export default function LoginForm({
  action,
}: {
  action: (prev: LoginState, formData: FormData) => Promise<LoginState>;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    action,
    {},
  );

  // The action has returned => the Set-Cookie header made it onto the
  // response. Only now is it safe to navigate.
  useEffect(() => {
    if (state.ok) {
      router.replace("/");
      router.refresh();
    }
  }, [state.ok, router]);

  return (
    <main style={{ maxWidth: 320, margin: "10vh auto", fontFamily: "system-ui" }}>
      <h1>Sign in</h1>
      {state.error && <p style={{ color: "crimson" }}>{state.error}</p>}
      <form action={formAction}>
        <input
          name="email"
          type="email"
          placeholder="Email"
          required
          style={{ display: "block", width: "100%", margin: "8px 0", padding: 8 }}
        />
        <input
          name="password"
          type="password"
          placeholder="Password"
          required
          style={{ display: "block", width: "100%", margin: "8px 0", padding: 8 }}
        />
        <button
          type="submit"
          disabled={pending}
          style={{ width: "100%", padding: 10 }}
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}