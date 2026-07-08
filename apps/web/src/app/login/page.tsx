// apps/web/src/app/login/page.tsx — tenant-scoped login.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveTenant } from "@wola/db";
import { db, TenantError } from "@/lib/tenant";
import { login, SESSION_COOKIE } from "@/lib/auth";

async function doLogin(formData: FormData) {
  "use server";
  const slug = (await headers()).get("x-tenant-slug");
  const tenant = slug ? await resolveTenant(db, slug) : null;
  if (!tenant) throw new TenantError(404, "Unknown tenant");

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const result = await login(email, password, tenant.id as string);
  if (!result) redirect("/login?error=1"); // same error for all failures

  (await cookies()).set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: result.expires,
    path: "/",
    // NO `domain` set => cookie scoped to the EXACT host (acme.localhost),
    // never the parent. This is what stops cross-subdomain session leak.
  });
  redirect("/");
}

export default async function LoginPage({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main style={{ maxWidth: 320, margin: "10vh auto", fontFamily: "system-ui" }}>
      <h1>Sign in</h1>
      {error && <p style={{ color: "crimson" }}>Invalid email or password.</p>}
      <form action={doLogin}>
        <input name="email" type="email" placeholder="Email" required
          style={{ display: "block", width: "100%", margin: "8px 0", padding: 8 }} />
        <input name="password" type="password" placeholder="Password" required
          style={{ display: "block", width: "100%", margin: "8px 0", padding: 8 }} />
        <button type="submit" style={{ width: "100%", padding: 10 }}>Sign in</button>
      </form>
    </main>
  );
}