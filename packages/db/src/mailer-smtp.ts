// packages/db/src/mailer-smtp.ts
// The one concrete Mailer implementation for now (see email.ts). Plain SMTP
// rather than a provider SDK (Resend/SES) so the SAME code path works
// against mailpit locally (SMTP_URL=smtp://localhost:1025, already in
// docker-compose.yml/.env.example) and a real relay in production — most
// providers, including SES and Resend, also expose an SMTP interface, so
// this isn't a dead end if a provider SDK is wanted later, it's an
// alternative Mailer that can sit next to this one.
import nodemailer from "nodemailer";
import type { Mailer } from "./email";

export interface SmtpConfig {
  url: string;       // smtp://user:pass@host:port or smtp://host:port
  fromAddress: string;
}

export function makeSmtpMailer(config: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport(config.url);

  return {
    async send(msg) {
      await transport.sendMail({
        from: config.fromAddress,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
      });
    },
  };
}
