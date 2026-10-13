// What we log (and optionally forward) when a request fails on the server.
//
// Goals: a person who sees "Reference: 123456789" can give us that number and we
// find ONE line that says what happened; and a database that isn't running reads
// as "database unreachable", not the bare `AggregateError` Node prints when
// localhost resolves to two addresses and both refuse.
//
// Privacy: no cookies, no request body, no query string; emails are masked and
// the message is truncated, because database error text can quote row values.

export type ErrorReport = {
  level: "error";
  ts: string;
  /** Next.js's error digest: the same number the person sees on the error page. */
  digest: string | null;
  kind: "database_unreachable" | "database_error" | "error";
  route: string | null;
  method: string;
  message: string;
  stack: string | null;
};

type Errish = Error & { digest?: string; code?: string; errors?: unknown[] };

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

const mask = (s: string) => s.replace(EMAIL, "[email]").slice(0, 400);

/** True when the failure is "couldn't connect to Postgres at all". */
export function isDatabaseUnreachable(err: unknown): boolean {
  const e = err as Errish;
  if (!e) return false;
  if (e.code === "ECONNREFUSED" || e.code === "ETIMEDOUT" || e.code === "CONNECT_TIMEOUT") return true;
  if (e.name === "AggregateError" && Array.isArray(e.errors)) {
    return e.errors.some((x) => ["ECONNREFUSED", "ETIMEDOUT"].includes((x as Errish)?.code ?? ""));
  }
  return false;
}

export function buildErrorReport(
  err: unknown,
  req: { path: string; method: string },
  ctx: { routePath?: string } = {},
): ErrorReport {
  const e = err as Errish;
  const down = isDatabaseUnreachable(err);
  const pg = typeof e?.code === "string" && /^[0-9A-Z]{5}$/.test(e.code) && !down; // Postgres SQLSTATE
  return {
    level: "error",
    ts: new Date().toISOString(),
    digest: e?.digest ?? null,
    kind: down ? "database_unreachable" : pg ? "database_error" : "error",
    route: ctx.routePath ?? req.path.split("?")[0],
    method: req.method,
    message: down
      ? "Database unreachable: Postgres refused or timed out (is it running, and is DATABASE_URL right?)"
      : mask(e?.message ?? String(err)),
    stack: down ? null : (e?.stack ?? null)?.split("\n").slice(0, 6).map(mask).join("\n") ?? null,
  };
}

/** Forward to a webhook when ERROR_WEBHOOK_URL is set. The message goes in `text`
 *  (Slack, Mattermost, Google Chat-style) and also in `content` (Discord), so either
 *  kind of incoming webhook works without configuration. Never throws and never waits
 *  long: reporting an error must not make the request worse. */
export async function forwardErrorReport(report: ErrorReport, url = process.env.ERROR_WEBHOOK_URL): Promise<void> {
  if (!url) return;
  const line = `Wola ${report.kind} on ${report.method} ${report.route ?? "?"} (ref ${report.digest ?? "none"}): ${report.message}`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: line,
        content: line.slice(0, 1900), // Discord caps a message at 2000 characters
        report,
      }),
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    /* the reporter is best-effort */
  }
}
