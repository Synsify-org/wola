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
import { SITE_DESCRIPTION, SITE_NAME, pageMeta, siteOrigin } from "@/lib/site";
import JsonLd from "@/components/json-ld";

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
export const metadata = pageMeta({ title: "Sign in", description: "Sign in to Wola with your work email to apply for, approve and track staff loans.", path: "/login", index: true });

export default async function LoginPage() {
  const h = await headers();
  const slug = h.get("x-tenant-slug");
  const tenant = slug ? await resolveTenant(db, slug) : null;
  const origin = await siteOrigin();
  return (
    <>
      {/* Structured data for the one public page: what Wola is and who makes it.
          Deliberately a software application, not a LocalBusiness — Wola is a
          web product with no storefront, and inventing an address or opening
          hours would be false data. */}
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "WebApplication",
            name: SITE_NAME,
            description: SITE_DESCRIPTION,
            url: `${origin}/login`,
            applicationCategory: "BusinessApplication",
            operatingSystem: "Any (web browser)",
            browserRequirements: "Requires JavaScript",
            inLanguage: "en",
          },
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            name: SITE_NAME,
            url: origin,
            logo: `${origin}/icon.svg`,
          },
        ]}
      />
      <LoginForm
        action={doLogin}
        tenantName={(tenant?.name as string | undefined) ?? null}
        host={(h.get("host") ?? "").split(":")[0] || null}
      />
    </>
  );
}