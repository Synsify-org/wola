// Sends queued email right after the request that queued it, with no scheduler.
//
// A page or action queues mail inside its own database transaction (sendEmail). When that
// transaction commits, tenantTx calls the hook registered here, which uses Next's after() to
// send that organisation's waiting mail once the response has gone out. The person never waits
// for the email provider, and a provider outage never breaks the page: the mail just stays
// queued and is retried by the next flush or the sweep below.
import "server-only";
import { after } from "next/server";
import { deliverTenantEmails, setEmailQueuedHook, type Sql } from "@wola/db";
import { getMailer } from "./mailer";

function logFailure(kind: string, e: unknown) {
  console.error(JSON.stringify({ level: "error", kind, message: e instanceof Error ? e.message : String(e) }));
}

const BATCH = 20;

/** Send one organisation's waiting email, in batches, for at most `budgetMs` (a serverless function
 *  has limited time after the response). Whatever is left stays queued for the next flush or sweep.
 *  Safe to call any time; does nothing without a mailer. */
export async function flushTenantEmails(db: Sql, tenantId: string, budgetMs = 9_000) {
  const mailer = getMailer();
  if (!mailer) return;
  const until = Date.now() + budgetMs;
  try {
    for (;;) {
      const r = await deliverTenantEmails(db, tenantId, mailer, { limit: BATCH });
      if (r.failed) console.error(JSON.stringify({ level: "warn", kind: "email_send_failed", failed: r.failed, sent: r.sent }));
      // A full batch with no failures means there is probably more waiting: carry on while time allows.
      if (r.sent < BATCH || r.failed > 0 || Date.now() > until) break;
    }
  } catch (e) { logFailure("email_flush_failed", e); }
}

// At most one retry sweep every two minutes per server instance, however often it is asked for.
let lastSweep = 0;
const SWEEP_EVERY_MS = 2 * 60_000;

/** Retry everything still waiting, for every active organisation. The health check (which an
 *  uptime monitor calls every few minutes) triggers it, so mail that failed once is retried even
 *  when nobody is doing anything in the app. */
export async function sweepWaitingEmails(db: Sql) {
  const mailer = getMailer();
  if (!mailer || Date.now() - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = Date.now();
  try {
    const tenants = await db`SELECT id FROM tenants WHERE status IN ('trial', 'active')`;
    for (const t of tenants) await flushTenantEmails(db, t.id as string, 40_000);
  } catch (e) { logFailure("email_sweep_failed", e); }
}

/** Connect the "mail was queued" signal from tenantTx to the sender. Called once, from tenant.ts. */
export function registerEmailFlush(db: Sql) {
  setEmailQueuedHook((tenantId) => after(() => flushTenantEmails(db, tenantId)));
}
