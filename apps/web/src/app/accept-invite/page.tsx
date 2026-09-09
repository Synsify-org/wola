// apps/web/src/app/accept-invite/page.tsx — consume an invitation.
// Public (no session) — the token itself is the credential, same shape as
// reset-password. Two paths: a brand-new identity sets a password here; an
// email that already has a Wola account elsewhere just accepts (that
// identity keeps its existing password) and gets the new tenant's membership.
import { cookies } from "next/headers";
import { loadInvitation, acceptInvitation } from "@wola/db";
import { db } from "@/lib/tenant";
import { createSession, SESSION_COOKIE } from "@/lib/auth";
import AcceptInviteForm from "./accept-invite-form";

export type AcceptInviteState = { error?: string; ok?: boolean };

async function doAccept(_prev: AcceptInviteState, formData: FormData): Promise<AcceptInviteState> {
  "use server";
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  // Empty fields mean "existing account, no password needed" — acceptInvitation
  // itself decides whether a password is actually required.
  if (password || confirm) {
    if (password.length < 8) return { error: "Password must be at least 8 characters." };
    if (password !== confirm) return { error: "Passwords don't match." };
  }

  const result = await acceptInvitation(db, token, password || null);
  if (!result.ok) return { error: result.error };

  // NOTE: redirect() here would discard the Set-Cookie header (same Next 16
  // gotcha as login) — return state, let the client navigate on success.
  const session = await createSession(result.userId, result.tenantId);
  (await cookies()).set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: session.expires,
    path: "/",
  });

  return { ok: true };
}

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  let invite: { email: string; role: string; tenantName: string; needsPassword: boolean } | null = null;
  if (token) {
    const inv = await loadInvitation(db, token);
    if (inv) {
      const [tenant] = await db`SELECT name FROM tenants WHERE id = ${inv.tenantId}`;
      invite = {
        email: inv.email,
        role: inv.role,
        tenantName: (tenant?.name as string) ?? "Wola",
        needsPassword: !inv.existingUserId,
      };
    }
  }

  return <AcceptInviteForm action={doAccept} token={token ?? ""} invite={invite} />;
}
