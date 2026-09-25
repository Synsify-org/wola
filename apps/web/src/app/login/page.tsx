// apps/web/src/app/login/page.tsx — tenant-scoped login.
// NOTE: redirect() inside a server action can DISCARD the Set-Cookie header in
// Next 16 — the cookie is only written to the response when the action returns
// normally. So this action returns state, and the client navigates.
import { clientIp } from "@/lib/client-ip";
import { cookies, headers } from "next/headers";
import { resolveTenant } from "@wola/db";
import { db, TenantError } from "@/lib/tenant";
import { login, SESSION_COOKIE } from "@/lib/auth";
import LoginForm from "./login-form";

export type LoginState = { error?: string; ok?: boolean };

async function doLogin(_prev: LoginState, formData: FormData): Promise<LoginState> {
  "use server";
  const h = await headers();
  const slug = h.get("x-tenant-slug");
  const tenant = slug ? await resolveTenant(db, slug) : null;
  if (!tenant) throw new TenantError(404, "Unknown tenant");

  const ip = clientIp(h);

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const remember = formData.get("remember") === "1";
  const result = await login(email, password, tenant.id as string, ip, remember);
  if (!result.ok) {
    return {
      error: result.reason === "rate_limited"
        ? "Too many attempts. Try again in a few minutes."
        : "Invalid email or password.",
    };
  }

  (await cookies()).set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: result.expires,
    path: "/",
    // NO `domain` => cookie scoped to the exact host. This is what stops
    // cross-subdomain session leak between tenants.
  });

  return { ok: true };
}

// The tenant's name and address are shown on the form so people can see
// which company they're signing into before typing a password — the
// cheapest defence against a look-alike phishing page. Display only; the
// action above re-resolves the tenant itself.
export default async function LoginPage() {
  const h = await headers();
  const slug = h.get("x-tenant-slug");
  const tenant = slug ? await resolveTenant(db, slug) : null;
  return (
    <LoginForm
      action={doLogin}
      tenantName={(tenant?.name as string | undefined) ?? null}
      host={(h.get("host") ?? "").split(":")[0] || null}
    />
  );
}