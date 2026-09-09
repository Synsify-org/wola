// packages/db/src/email.ts — Tier 1.1: durable, retryable transactional
// email. Application code enqueues inside the same tenantTx as whatever
// triggered it (mirrors the audit() pattern in client.ts) and NEVER awaits
// a real network send on the request path. Delivery is a separate process
// (scripts/process-email-outbox.mjs) — see deliverPendingEmails below for
// why that process needs the admin connection, not wola_app.
import type { Tx, Sql } from "./client";

export interface EmailTemplate {
  subject: string;
  html: string; // may contain {{var}} placeholders
}

/** Fill {{var}} placeholders. Missing vars render as empty string, never the
 *  literal "{{var}}" — a half-rendered template reaching an inbox is worse
 *  than a blank field. */
export function renderTemplate(tpl: string, data: Record<string, string | number>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = data[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

export interface SendEmailArgs {
  tenantId: string;
  to: string;
  template: EmailTemplate;
  data?: Record<string, string | number>;
}

/** Enqueue an email. Call inside the same tenantTx as the triggering
 *  mutation, so the send and the thing it's about commit or roll back
 *  together. Returns the outbox row id, not a delivery result — delivery
 *  hasn't happened yet. */
export async function sendEmail(tx: Tx, args: SendEmailArgs): Promise<{ id: string }> {
  const data = args.data ?? {};
  const subject = renderTemplate(args.template.subject, data);
  const html = renderTemplate(args.template.html, data);
  const [row] = await tx`
    INSERT INTO email_outbox (tenant_id, to_email, subject, body_html)
    VALUES (${args.tenantId}, ${args.to}, ${subject}, ${html})
    RETURNING id`;
  return { id: row.id as string };
}

const MAX_ATTEMPTS = 5;

/** Provider-agnostic transport. The SMTP implementation (mailer-smtp.ts) is
 *  ONE implementation of this, not the interface itself — swapping to
 *  Resend/SES later means writing a new Mailer, not touching this file. */
export interface Mailer {
  send(msg: { to: string; subject: string; html: string }): Promise<void>;
}

/** Attempt delivery of pending outbox rows, oldest first, up to `limit` per
 *  call (this is meant to be invoked repeatedly, e.g. by a cron-triggered
 *  script, not run once to drain everything).
 *
 *  `sql` MUST be an admin/owner connection (bypasses RLS). This sweeps EVERY
 *  tenant's queue in one pass, which the RLS-bound wola_app role structurally
 *  cannot do outside a single tenantTx. That's not a shortcut — it mirrors
 *  the existing precedent (scripts/migrate.mjs, onboard-tenant.mjs): a
 *  legitimate system process outside request-handling gets the admin
 *  connection; application code never does. */
export async function deliverPendingEmails(
  sql: Sql,
  mailer: Mailer,
  limit = 50,
): Promise<{ sent: number; failed: number; stillPending: number }> {
  const rows = await sql`
    SELECT id, to_email, subject, body_html, attempts
    FROM email_outbox
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT ${limit}`;

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      await mailer.send({
        to: row.to_email as string,
        subject: row.subject as string,
        html: row.body_html as string,
      });
      await sql`
        UPDATE email_outbox SET status = 'sent', sent_at = now()
        WHERE id = ${row.id}`;
      sent++;
    } catch (e) {
      const attempts = Number(row.attempts) + 1;
      // Capped retry: after MAX_ATTEMPTS this stops being retried and needs
      // a human to look at last_error, rather than retrying forever.
      const nextStatus = attempts >= MAX_ATTEMPTS ? "failed" : "pending";
      await sql`
        UPDATE email_outbox
        SET attempts = ${attempts}, status = ${nextStatus},
            last_error = ${e instanceof Error ? e.message : String(e)}
        WHERE id = ${row.id}`;
      failed++;
    }
  }

  const [{ n: stillPending }] = await sql`
    SELECT count(*)::int AS n FROM email_outbox WHERE status = 'pending'`;

  return { sent, failed, stillPending: Number(stillPending) };
}
