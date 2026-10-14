import { describe, test, expect } from "vitest";
import { systemChecks } from "../platform-checks";
import type { Operator, PlatformConsole } from "@wola/db";

const NOW = new Date("2026-10-14T12:00:00Z");
const health = (over: Partial<PlatformConsole["health"]> = {}): PlatformConsole["health"] => ({
  failedSignIns24h: 3, activeSessions: 4, emailsPending: 0, emailsFailed: 0, emailsSent7d: 12, oldestPendingAt: null, ...over,
});
const op = (over: Partial<Operator> = {}): Operator => ({ id: "1", email: "me@wola.africa", name: "Me", status: "active", mfaEnrolled: true, lastSignInAt: null, ...over });
const byId = (c: ReturnType<typeof systemChecks>, id: string) => c.find((x) => x.id === id)!;
const FULL = { MFA_ENCRYPTION_KEY: "k", ERROR_WEBHOOK_URL: "https://hooks.example/x" };

describe("platform checks", () => {
  test("a fully set-up platform has nothing to look at", () => {
    const c = systemChecks({ health: health(), operators: [op()] }, FULL, NOW);
    expect(c.every((x) => x.status === "ok")).toBe(true);
  });

  test("no two-step key: says so, and what it means", () => {
    const k = byId(systemChecks({ health: health(), operators: [op()] }, {}, NOW), "mfa-key");
    expect(k.status).toBe("warn");
    expect(k.detail).toMatch(/password only/);
  });

  test("operators who haven't enrolled are named (only once the key is on)", () => {
    const c = systemChecks({ health: health(), operators: [op({ mfaEnrolled: false, email: "late@wola.africa" })] }, FULL, NOW);
    expect(byId(c, "operators-mfa").detail).toContain("late@wola.africa");
    expect(systemChecks({ health: health(), operators: [op({ mfaEnrolled: false })] }, {}, NOW).some((x) => x.id === "operators-mfa")).toBe(false);
  });

  test("a disabled operator isn't nagged about", () => {
    const c = systemChecks({ health: health(), operators: [op(), op({ id: "2", status: "disabled", mfaEnrolled: false })] }, FULL, NOW);
    expect(c.some((x) => x.id === "operators-mfa")).toBe(false);
  });

  test("no alert destination is a to-do, never a failure", () => {
    expect(byId(systemChecks({ health: health(), operators: [op()] }, { MFA_ENCRYPTION_KEY: "k" }, NOW), "alerts").status).toBe("todo");
  });

  test("email is judged by what happens: waiting for hours means nothing is sending", () => {
    const old = new Date(NOW.getTime() - 3 * 3600_000).toISOString();
    const e = byId(systemChecks({ health: health({ emailsPending: 4, oldestPendingAt: old }), operators: [op()] }, FULL, NOW), "email");
    expect(e.status).toBe("warn");
    expect(e.detail).toMatch(/4 emails have been waiting 3 hours/);
    expect(e.detail).toMatch(/Nothing is sending them/);
  });

  test("a recent queue is fine; failures are a warning; never-sent is unproven, not broken", () => {
    const recent = new Date(NOW.getTime() - 2 * 60_000).toISOString();
    expect(byId(systemChecks({ health: health({ emailsPending: 2, oldestPendingAt: recent }), operators: [op()] }, FULL, NOW), "email").status).toBe("ok");
    expect(byId(systemChecks({ health: health({ emailsFailed: 1 }), operators: [op()] }, FULL, NOW), "email").status).toBe("warn");
    expect(byId(systemChecks({ health: health({ emailsSent7d: 0 }), operators: [op()] }, FULL, NOW), "email").status).toBe("todo");
  });

  test("a burst of failed sign-ins is worth a look", () => {
    expect(byId(systemChecks({ health: health({ failedSignIns24h: 80 }), operators: [op()] }, FULL, NOW), "signins").status).toBe("warn");
  });

  test("it never echoes a secret's value", () => {
    const text = JSON.stringify(systemChecks({ health: health(), operators: [op()] }, { MFA_ENCRYPTION_KEY: "SUPERSECRETKEY", ERROR_WEBHOOK_URL: "https://hooks.example/SECRETPATH" }, NOW));
    expect(text).not.toContain("SUPERSECRETKEY");
    expect(text).not.toContain("SECRETPATH");
  });
});
