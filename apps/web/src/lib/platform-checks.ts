// "Is the platform set up the way it should be?" for the console's Overview. Pure: it is
// handed the figures and the environment, so it can be tested and never reads secrets (only
// whether each one is SET; values are never shown).
import type { Operator, PlatformConsole } from "@wola/db";

export type CheckStatus = "ok" | "warn" | "todo";
export type Check = { id: string; label: string; status: CheckStatus; detail: string };

type Env = Record<string, string | undefined>;

export function systemChecks(
  input: { health: PlatformConsole["health"]; operators: Operator[] },
  env: Env = process.env,
  now: Date = new Date(),
): Check[] {
  const { health, operators } = input;
  const active = operators.filter((o) => o.status === "active");
  const unenrolled = active.filter((o) => !o.mfaEnrolled);
  const checks: Check[] = [];

  checks.push({ id: "db", label: "Database", status: "ok", detail: "Connected and answering." });

  checks.push(env.MFA_ENCRYPTION_KEY
    ? { id: "mfa-key", label: "Two-step sign-in", status: "ok", detail: "Available, and required for platform operators." }
    : { id: "mfa-key", label: "Two-step sign-in", status: "warn", detail: "Not switched on: no MFA_ENCRYPTION_KEY on the server, so operators and organisations sign in with a password only." });

  if (env.MFA_ENCRYPTION_KEY && unenrolled.length > 0) {
    checks.push({ id: "operators-mfa", label: "Operator accounts", status: "warn", detail: `${unenrolled.length} operator${unenrolled.length === 1 ? " has" : "s have"} not set up two-step sign-in yet: ${unenrolled.map((o) => o.email).join(", ")}.` });
  }

  checks.push(env.ERROR_WEBHOOK_URL
    ? { id: "alerts", label: "Error alerts", status: "ok", detail: "Server errors are sent to your alert channel." }
    : { id: "alerts", label: "Error alerts", status: "todo", detail: "No alert destination (ERROR_WEBHOOK_URL). Errors are logged, but nobody is told when one happens." });

  // Email is judged by what actually HAPPENS, not by a setting: the sender runs outside the
  // web server (a scheduled job), so the web server can't see whether it is configured.
  const waitedMin = health.oldestPendingAt ? Math.floor((now.getTime() - new Date(health.oldestPendingAt).getTime()) / 60_000) : 0;
  if (health.emailsFailed > 0) {
    checks.push({ id: "email", label: "Email delivery", status: "warn", detail: `${health.emailsFailed} email${health.emailsFailed === 1 ? "" : "s"} failed after several attempts. Check the email provider and the sender's log.` });
  } else if (health.emailsPending > 0 && waitedMin >= 30) {
    checks.push({ id: "email", label: "Email delivery", status: "warn", detail: `${health.emailsPending} email${health.emailsPending === 1 ? " has" : "s have"} been waiting ${waitedMin >= 120 ? Math.floor(waitedMin / 60) + " hours" : waitedMin + " minutes"}. Nothing is sending them: invitations, password resets and approval alerts are not reaching people. Set up the sender and an email provider.` });
  } else if (health.emailsPending > 0) {
    checks.push({ id: "email", label: "Email delivery", status: "ok", detail: `${health.emailsPending} waiting to be sent, queued recently.` });
  } else if (health.emailsSent7d > 0) {
    checks.push({ id: "email", label: "Email delivery", status: "ok", detail: `${health.emailsSent7d} sent in the last 7 days; nothing waiting.` });
  } else {
    checks.push({ id: "email", label: "Email delivery", status: "todo", detail: "No email has been sent from this platform yet, so delivery is unproven. Invitations and password resets depend on it." });
  }

  checks.push(health.failedSignIns24h > 50
    ? { id: "signins", label: "Failed sign-ins (24 h)", status: "warn", detail: `${health.failedSignIns24h} failed attempts in the last 24 hours: worth a look.` }
    : { id: "signins", label: "Failed sign-ins (24 h)", status: "ok", detail: `${health.failedSignIns24h} in the last 24 hours.` });

  return checks;
}
