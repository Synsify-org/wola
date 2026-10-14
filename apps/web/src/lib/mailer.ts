// Which email provider this deployment sends through. Today: Resend, from two settings that
// live in the hosting dashboard (never in the repository):
//   RESEND_API_KEY   the API key (Resend dashboard -> API Keys)
//   EMAIL_FROM       "Wola <no-reply@bookings.synsify.africa>": an address on a domain verified in Resend
//   EMAIL_REPLY_TO   optional: where replies go
// With either missing there is no mailer: mail stays queued (and the platform console says so)
// instead of failing.
import "server-only";
import { makeResendMailer, type Mailer } from "@wola/db";

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export function getMailer(): Mailer | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return null;
  return makeResendMailer({ apiKey, from, replyTo: process.env.EMAIL_REPLY_TO || undefined });
}
