// apps/web/src/app/admin/login/page.tsx — super-admin sign-in.
// Outside the tenant model entirely: no subdomain/tenant resolution here.
import { cookies, headers } from "next/headers";
import { superLogin, SUPER_SESSION_COOKIE } from "@/lib/super-admin-auth";
import SuperLoginForm from "./login-form";

export type SuperLoginState = { error?: string; ok?: boolean };

async function doSuperLogin(_prev: SuperLoginState, formData: FormData): Promise<SuperLoginState> {
  "use server";
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const result = await superLogin(email, password, ip);
  if (!result.ok) {
    return {
      error: result.reason === "rate_limited"
        ? "Too many attempts. Try again in a few minutes."
        : "Invalid email or password.",
    };
  }

  // Same Next 16 gotcha as the tenant login: don't redirect() inside the
  // action or the Set-Cookie header is discarded — return state instead.
  (await cookies()).set(SUPER_SESSION_COOKIE, result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: result.expires,
    path: "/",
  });
  return { ok: true };
}

export default function SuperAdminLoginPage() {
  return <SuperLoginForm action={doSuperLogin} />;
}
