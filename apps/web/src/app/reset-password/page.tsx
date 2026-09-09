// apps/web/src/app/reset-password/page.tsx — consume a reset link.
// Public (no session) — the token itself is the credential.
import { resetPassword } from "@wola/db";
import { db } from "@/lib/tenant";
import ResetPasswordForm from "./reset-password-form";

export type ResetPasswordState = { error?: string; ok?: boolean };

async function doReset(_prev: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  "use server";
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== confirm) return { error: "Passwords don't match." };

  // password_resets/sessions/users aren't tenant-scoped tables (same reason
  // sessions isn't — looked up by token before any tenant context exists),
  // so this runs on the plain connection, not inside tenantTx.
  const result = await resetPassword(db, token, password);
  if (!result.ok) return { error: result.error };
  return { ok: true };
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <ResetPasswordForm action={doReset} token={token ?? ""} />;
}
