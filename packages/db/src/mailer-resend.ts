// packages/db/src/mailer-resend.ts
// Sends through Resend's HTTPS API. Plain fetch, no SDK: nothing to install, nothing that can
// break a serverless build, and it works anywhere the app runs. The sender address must be on a
// domain that is verified in Resend (SPF/DKIM), for example "Wola <no-reply@bookings.synsify.africa>".
import type { Mailer } from "./email";

export interface ResendConfig {
  apiKey: string;
  from: string;          // "Name <address@verified-domain>"
  replyTo?: string;
  fetchImpl?: typeof fetch; // for tests
  /** Resend allows about 2 requests a second by default, so sends are spaced out (ms). */
  minGapMs?: number;
  sleep?: (ms: number) => Promise<void>; // for tests
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function makeResendMailer(config: ResendConfig): Mailer {
  const doFetch = config.fetchImpl ?? fetch;
  const sleep = config.sleep ?? wait;
  const gap = config.minGapMs ?? 550;
  let last = 0; // when the previous request left, so a burst (a bulk invite) stays under the limit
  return {
    async send(msg) {
      for (let attempt = 1; ; attempt++) {
        const since = Date.now() - last;
        if (since < gap) await sleep(gap - since);
        last = Date.now();
        const res = await post(msg);
        // 429: told to slow down. Wait as long as Resend says (at most 5s) and try again, 3 times.
        if (res.status === 429 && attempt < 3) {
          const asked = Number(res.headers.get("retry-after"));
          await sleep(Math.min(Math.max(Number.isFinite(asked) && asked > 0 ? asked * 1000 : 1000, 500), 5000));
          continue;
        }
        if (!res.ok) {
          // Resend explains itself in the body ({ message }); keep it short, never echo the key.
          const detail = (await res.text().catch(() => "")).slice(0, 300);
          throw new Error(`Resend ${res.status}: ${detail || res.statusText}`);
        }
        return;
      }
    },
  };

  function post(msg: { to: string; subject: string; html: string; text?: string }) {
    return doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: config.from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        ...(msg.text ? { text: msg.text } : {}),
        ...(config.replyTo ? { reply_to: config.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  }
}
