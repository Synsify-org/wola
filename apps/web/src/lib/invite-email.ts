// The invitation email, shared by "HR invites an employee" (employees-actions)
// and "an administrator invites anyone" (settings/access). The invitee sets
// their own password via the link — nobody ever sees or relays a password.
import { headers } from "next/headers";
import { sendEmail, type Tx } from "@wola/db";
import { roleLabel } from "@/lib/product-summary";

const INVITE_TEMPLATE = {
  subject: "You've been invited to join {{tenantName}} on Wola",
  html:
    "<p>{{inviterName}} has invited you to join {{tenantName}} on Wola as {{role}}.</p>" +
    "<p><a href=\"{{inviteUrl}}\">Accept the invitation</a> — this link expires in 7 days.</p>",
};

/** Origin of the app the inviter is using (the tenant's own subdomain). */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
  return `${protocol}://${h.get("host")}`;
}

export async function sendInviteEmail(
  tx: Tx,
  args: { tenantId: string; to: string; role: string; token: string; origin: string; inviterUserId: string },
): Promise<void> {
  const [inviter] = await tx`
    SELECT e.full_name, u.email FROM users u LEFT JOIN employees e ON e.user_id = u.id
    WHERE u.id = ${args.inviterUserId}`;
  const [tenant] = await tx`SELECT name FROM tenants WHERE id = ${args.tenantId}`;
  await sendEmail(tx, {
    tenantId: args.tenantId,
    to: args.to,
    template: INVITE_TEMPLATE,
    data: {
      tenantName: (tenant?.name as string) ?? "Wola",
      inviterName: (inviter?.full_name as string) ?? (inviter?.email as string) ?? "A colleague",
      role: roleLabel(args.role),
      inviteUrl: `${args.origin}/accept-invite?token=${args.token}`,
    },
  });
}
