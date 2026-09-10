// scripts/process-email-outbox.mjs — delivers pending rows from
// email_outbox. Meant to be invoked repeatedly (cron/scheduled task), not
// run once to drain everything — each run processes one batch.
//
// Runs as the ADMIN role deliberately: delivering mail is a cross-tenant
// sweep (every tenant's queue, one pass), which the RLS-bound wola_app role
// structurally cannot do outside a single tenantTx. Same precedent as
// scripts/migrate.mjs and onboard-tenant.mjs.
//
// Usage: node --import tsx --import dotenv/config scripts/process-email-outbox.mjs
import postgres from "postgres";
import "dotenv/config";
import { deliverPendingEmails } from "../packages/db/src/email.ts";
import { makeSmtpMailer } from "../packages/db/src/mailer-smtp.ts";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) { console.error("DATABASE_ADMIN_URL is required"); process.exit(1); }

const smtpUrl = process.env.SMTP_URL;
if (!smtpUrl) { console.error("SMTP_URL is required (mailpit locally: smtp://localhost:1025)"); process.exit(1); }

const fromAddress = process.env.EMAIL_FROM ?? "no-reply@wola.africa";

const sql = postgres(adminUrl, { max: 1 });
const mailer = makeSmtpMailer({ url: smtpUrl, fromAddress });

try {
  const result = await deliverPendingEmails(sql, mailer);
  console.log(`sent=${result.sent} failed=${result.failed} stillPending=${result.stillPending}`);
} finally {
  await sql.end();
}
