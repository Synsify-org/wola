// apps/web/src/app/forgot-password/page.tsx — request a reset link.
// Public (no session). Always returns the SAME message regardless of
// whether the email exists — createPasswordReset() tells the truth
// internally (returns null vs a token) so the email only sends when
// there's really someone to send it to, but that distinction must never
// reach the response. Same enumeration defense as login().
import { headers } from "next/headers";
import { resolveTenant, tenantTx, createPasswordReset, sendEmail, type Tx } from "@wola/db";
import { db, TenantError } from "@/lib/tenant";
import ForgotPasswordForm from "./forgot-password-form";

export type ForgotPasswordState = { submitted?: boolean };

const RESET_TEMPLATE = {
  subject: "Reset your Wola password",
  html: `
    <p>Hi,</p>
    <p>Someone requested a password reset for your Wola account at {{tenantName}}.</p>
    <p><a href="{{resetUrl}}">Click here to set a new password</a> — this link expires in 1 hour and can only be used once.</p>
    <p>If you didn't request this, you can ignore this email; your password won't change.</p>
  `,
};

async function requestReset(_prev: ForgotPasswordState, formData: FormData): Promise<ForgotPasswordState> {
  "use server";
  const h = await headers();
  const slug = h.get("x-tenant-slug");
  const tenant = slug ? await resolveTenant(db, slug) : null;
  if (!tenant) throw new TenantError(404, "Unknown tenant");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (email) {
    const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
    const origin = `${protocol}://${h.get("host")}`;

    await tenantTx(db, tenant.id as string, async (tx: Tx) => {
      const issued = await createPasswordReset(tx, email, tenant.id as string);
      if (!issued) return; // silently no-op — see file header
      await sendEmail(tx, {
        tenantId: tenant.id as string,
        to: email,
        template: RESET_TEMPLATE,
        data: {
          tenantName: tenant.name as string,
          resetUrl: `${origin}/reset-password?token=${issued.token}`,
        },
      });
    });
  }

  return { submitted: true };
}

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm action={requestReset} />;
}
