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

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/** Fill {{var}} placeholders. Missing vars render as empty string, never the
 *  literal "{{var}}" — a half-rendered template reaching an inbox is worse
 *  than a blank field. Pass `escape: true` for HTML bodies: a person's name or a
 *  rejection reason is data, so it must not be able to add markup or links to an
 *  email that comes from Wola. */
export function renderTemplate(tpl: string, data: Record<string, string | number>, escape = false): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = data[key];
    const text = v === undefined || v === null ? "" : String(v);
    return escape ? escapeHtml(text) : text;
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
 *  hasn't happened yet.
 *
 *  An organisation can switch its email OFF (tenants.settings.email.enabled = false). A demo
 *  organisation must: its people have made-up addresses, and mail to them would bounce and harm the
 *  sending domain's reputation. Nothing is queued then, and `id` is null. Everything else is unaffected. */
export async function sendEmail(tx: Tx, args: SendEmailArgs): Promise<{ id: string | null }> {
  const [setting] = await tx`SELECT settings #>> '{email,enabled}' AS enabled FROM tenants WHERE id = ${args.tenantId}`;
  if (setting?.enabled === "false") return { id: null };
  // Addresses on reserved names (RFC 2606/6761) can never be delivered. Practice accounts use them, and
  // mail to them would only bounce and harm the sending domain's reputation, so nothing is queued.
  if (/\.(invalid|test|example|localhost)$/i.test(args.to.trim())) return { id: null };
  const data = args.data ?? {};
  // A subject is one line of plain text: no line breaks (header injection), no escaping.
  const subject = renderTemplate(args.template.subject, data).replace(/[\r\n]+/g, " ").trim();
  const html = renderTemplate(args.template.html, data, true);
  const [row] = await tx`
    INSERT INTO email_outbox (tenant_id, to_email, subject, body_html)
    VALUES (${args.tenantId}, ${args.to}, ${subject}, ${html})
    RETURNING id`;
  queued.add(tx);
  return { id: row.id as string };
}

// Which transactions queued an email. tenantTx (client.ts) reads this once the transaction has
// committed and asks the app to send straight away, so mail goes out in seconds with no
// scheduler. A WeakSet: it never keeps a finished transaction alive.
const queued = new WeakSet<object>();
export const emailWasQueued = (tx: object) => queued.has(tx);

const MAX_ATTEMPTS = 5;

/** Provider-agnostic transport. The SMTP implementation (mailer-smtp.ts) is
 *  ONE implementation of this, not the interface itself — swapping to
 *  Resend/SES later means writing a new Mailer, not touching this file. */
export interface Mailer {
  send(msg: { to: string; subject: string; html: string; text?: string }): Promise<void>;
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

// ---------------------------------------------------------------------------------------------
// Sending from inside the app.
//
// deliverPendingEmails above sweeps EVERY organisation with the admin connection, which suits a
// script. The web app has only the restricted role (wola_app) and must keep it that way, so it
// sends ONE organisation's mail at a time, through that organisation's own transaction. Row-level
// security then guarantees the sender can read and update nothing else: no privileged connection
// and no new database permission.
//
// Three short steps, so no database connection is held open while a provider is slow:
//   1. claim a batch (a 5-minute lease, so two requests at once never send the same email twice),
//   2. send each one, outside any transaction,
//   3. write the outcome: sent, or one more attempt (failed for good after MAX_ATTEMPTS).
// Mail that has waited longer than EXPIRE_AFTER_DAYS is not sent: a reset link that old has
// expired and an invitation that old should be re-issued. It is marked failed, with the reason.
// ---------------------------------------------------------------------------------------------
const EXPIRE_AFTER_DAYS = 3;
const LEASE_MINUTES = 5;

export interface FlushResult { sent: number; failed: number; expired: number }

async function scoped<T>(sql: Sql, tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx as Tx);
  }) as Promise<T>;
}

/** Send one organisation's waiting email. Never throws for a delivery problem: a failed send is
 *  recorded on the row and retried on the next call. */
export async function deliverTenantEmails(
  sql: Sql,
  tenantId: string,
  mailer: Mailer,
  opts: { limit?: number } = {},
): Promise<FlushResult> {
  const limit = opts.limit ?? 20;

  const { expired, rows, brand } = await scoped(sql, tenantId, async (tx) => {
    const expired = await tx`
      UPDATE email_outbox
      SET status = 'failed', last_error = ${`not sent within ${EXPIRE_AFTER_DAYS} days`}, claimed_at = NULL
      WHERE tenant_id = ${tenantId} AND status = 'pending'
        AND created_at < now() - ${EXPIRE_AFTER_DAYS}::int * interval '1 day'
      RETURNING id`;
    const rows = await tx`
      UPDATE email_outbox SET claimed_at = now()
      WHERE id IN (
        SELECT id FROM email_outbox
        WHERE tenant_id = ${tenantId} AND status = 'pending'
          AND (claimed_at IS NULL OR claimed_at < now() - ${LEASE_MINUTES}::int * interval '1 minute')
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
      RETURNING id, to_email, subject, body_html, attempts`;
    const [t] = rows.length ? await tx`SELECT name FROM tenants WHERE id = ${tenantId}` : [];
    return { expired: expired.length, rows, brand: (t?.name as string | undefined) ?? "Wola" };
  });

  const outcomes: { id: string; error?: string; attempts: number }[] = [];
  for (const row of rows) {
    try {
      const html = wrapEmail(row.body_html as string, brand);
      await mailer.send({ to: row.to_email as string, subject: row.subject as string, html, text: htmlToText(row.body_html as string) });
      outcomes.push({ id: row.id as string, attempts: Number(row.attempts) });
    } catch (e) {
      outcomes.push({ id: row.id as string, attempts: Number(row.attempts), error: (e instanceof Error ? e.message : String(e)).slice(0, 500) });
    }
  }

  if (outcomes.length) {
    await scoped(sql, tenantId, async (tx) => {
      for (const o of outcomes) {
        if (!o.error) {
          await tx`UPDATE email_outbox SET status = 'sent', sent_at = now(), claimed_at = NULL, last_error = NULL WHERE id = ${o.id}`;
        } else {
          const attempts = o.attempts + 1;
          await tx`
            UPDATE email_outbox
            SET attempts = ${attempts}, status = ${attempts >= MAX_ATTEMPTS ? "failed" : "pending"},
                last_error = ${o.error}, claimed_at = NULL
            WHERE id = ${o.id}`;
        }
      }
    });
  }

  return { sent: outcomes.filter((o) => !o.error).length, failed: outcomes.filter((o) => o.error).length, expired };
}

/** Retry sweep: every active organisation's waiting email, one organisation at a time. */
export async function deliverAllTenantEmails(sql: Sql, mailer: Mailer): Promise<FlushResult> {
  const tenants = await sql`SELECT id FROM tenants WHERE status IN ('trial', 'active')`;
  const total: FlushResult = { sent: 0, failed: 0, expired: 0 };
  for (const t of tenants) {
    const r = await deliverTenantEmails(sql, t.id as string, mailer);
    total.sent += r.sent; total.failed += r.failed; total.expired += r.expired;
  }
  return total;
}

// What the app does when a transaction that queued mail has committed (see tenantTx). The web
// app registers it; scripts and tests do not, so queuing stays side-effect free there.
let onQueued: ((tenantId: string) => void) | null = null;
export const setEmailQueuedHook = (fn: ((tenantId: string) => void) | null) => { onQueued = fn; };
export function notifyEmailQueued(tenantId: string) {
  try { onQueued?.(tenantId); } catch { /* sending is best-effort: the row stays queued for the next sweep */ }
}

/** The plain look every email shares: the organisation's name on top, a quiet footer. Inline
 *  styles and a table, because that is what mail programs render reliably. */
export function wrapEmail(bodyHtml: string, brand = "Wola"): string {
  const b = escapeHtml(brand);
  return `<!doctype html><html><body style="margin:0;background:#f4f6f5;font-family:Arial,Helvetica,sans-serif;color:#1c2b25">` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f5;padding:24px 12px"><tr><td align="center">` +
    `<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e3e8e5;border-radius:12px">` +
    `<tr><td style="padding:18px 28px;border-bottom:1px solid #e3e8e5;font-size:16px;font-weight:700;color:#0f6b3a">${b}</td></tr>` +
    `<tr><td style="padding:24px 28px;font-size:15px;line-height:1.6">${bodyHtml}</td></tr>` +
    `<tr><td style="padding:14px 28px;border-top:1px solid #e3e8e5;font-size:12px;color:#6b7a73">Sent through Wola for ${b}. If you were not expecting this email, you can ignore it.</td></tr>` +
    `</table></td></tr></table></body></html>`;
}

/** A readable plain-text copy (mail programs and spam filters like having one). Links keep their address. */
export function htmlToText(html: string): string {
  return html
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => `${label.replace(/<[^>]+>/g, "")} (${href})`)
    .replace(/<\/(p|div|h\d|li|tr)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
