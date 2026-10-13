// apps/web/src/app/admin/login/page.tsx — super-admin sign-in.
// Outside the tenant model entirely: no subdomain/tenant resolution here.
import { clientIp } from "@/lib/client-ip";
import { cookies, headers } from "next/headers";
import { superLogin, superCompleteLogin, SUPER_SESSION_COOKIE } from "@/lib/super-admin-auth";
import SuperLoginForm from "./login-form";
import { pageMeta } from "@/lib/site";

export type SuperLoginState = { error?: string; ok?: boolean; /** password accepted; now a code is needed */ mfa?: { challenge: string } };

async function setSession(token: string, expires: Date) {
  // Same Next 16 gotcha as the tenant login: don't redirect() inside the
  // action or the Set-Cookie header is discarded, return state instead.
  (await cookies()).set(SUPER_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires,
    path: "/",
  });
}

async function doSuperLogin(_prev: SuperLoginState, formData: FormData): Promise<SuperLoginState> {
  "use server";
  const h = await headers();
  const ip = clientIp(h);

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
  if (result.step === "code") return { mfa: { challenge: result.challenge } };
  await setSession(result.token, result.expires);
  return { ok: true };
}

async function doSuperVerify(_prev: SuperLoginState, formData: FormData): Promise<SuperLoginState> {
  "use server";
  const challenge = String(formData.get("challenge") ?? "");
  const code = String(formData.get("code") ?? "");
  if (!challenge || !code.trim() || code.length > 64) {
    return { mfa: { challenge }, error: "Enter the 6-digit code from your authenticator app." };
  }
  const r = await superCompleteLogin(challenge, code, clientIp(await headers()));
  if (!r.ok) {
    switch (r.reason) {
      case "unknown":
      case "expired": return { error: "That sign-in took too long. Enter your password again." };
      case "locked": return { error: "Too many wrong codes. Enter your password again to get a new one." };
      case "unavailable": return { error: "Two-step sign-in isn't available on this server right now." };
      default: return { mfa: { challenge }, error: "That code isn't right. Try the newest code from your app, or a recovery code." };
    }
  }
  await setSession(r.token, r.expires);
  return { ok: true };
}

export const metadata = pageMeta({ title: "Platform sign in", description: "Sign in to the Wola platform console.", path: "/admin/login" });

export default function SuperAdminLoginPage() {
  return <SuperLoginForm action={doSuperLogin} verifyAction={doSuperVerify} />;
}
