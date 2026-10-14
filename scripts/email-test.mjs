// scripts/email-test.mjs: send ONE test email through the same sender the app uses, to prove the
// provider settings work before anyone depends on them.
//
// It reads RESEND_API_KEY and EMAIL_FROM from apps/web/.env.local (the file the website itself reads)
// or, failing that, the .env file at the repository root. The same two settings go in Vercel for the live site:
//
//   RESEND_API_KEY=re_...                                  (never commit this file, never paste the key in chat)
//   EMAIL_FROM=Wola <no-reply@bookings.synsify.africa>
//
//   npm run email:test -- you@example.com
//
// It prints what Resend answered. A 403 "domain is not verified" means EMAIL_FROM is not on a
// verified domain; a 401 means the key is wrong.
import { config } from "dotenv";
import path from "node:path";
// dotenv never overrides a value that is already set, so a variable typed into the terminal still wins.
config({ path: path.resolve(import.meta.dirname, "../apps/web/.env.local"), quiet: true });
import { makeResendMailer } from "../packages/db/src/mailer-resend.ts";
import { wrapEmail, htmlToText } from "../packages/db/src/email.ts";

const to = process.argv[2];
const { RESEND_API_KEY: apiKey, EMAIL_FROM: from } = process.env;
if (!to || !apiKey || !from) {
  console.error(`Usage: npm run email:test -- you@example.com
Missing in apps/web/.env.local (or .env): ${[!apiKey && "RESEND_API_KEY", !from && "EMAIL_FROM"].filter(Boolean).join(", ") || "(nothing: give the address to send to)"}`);
  process.exit(1);
}
const body = "<p>This is a test email from Wola.</p><p>If you can read it, sending works: invitations, password resets and approval alerts will reach people.</p>";
try {
  await makeResendMailer({ apiKey, from }).send({ to, subject: "Wola test email", html: wrapEmail(body, "Wola"), text: htmlToText(body) });
  console.log(`Sent to ${to}. Check the inbox (and the spam folder the first time).`);
} catch (e) {
  console.error("Not sent:", e.message);
  process.exit(1);
}
