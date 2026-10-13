import { describe, test, expect, vi, afterEach } from "vitest";
import { buildErrorReport, forwardErrorReport, isDatabaseUnreachable } from "../error-report";

const agg = (codes: string[]) => {
  const e = new AggregateError(codes.map((c) => Object.assign(new Error(c), { code: c })), "");
  return e;
};

describe("error reports", () => {
  test("a database that refuses connections reads as that, not as a bare AggregateError", () => {
    const err = agg(["ECONNREFUSED", "ECONNREFUSED"]);
    expect(isDatabaseUnreachable(err)).toBe(true);
    const r = buildErrorReport(err, { path: "/loans", method: "GET" });
    expect(r.kind).toBe("database_unreachable");
    expect(r.message).toMatch(/Database unreachable/);
    expect(r.stack).toBeNull();
  });

  test("a plain connection-refused error is recognised too", () => {
    expect(isDatabaseUnreachable(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isDatabaseUnreachable(new Error("something else"))).toBe(false);
    expect(isDatabaseUnreachable(null)).toBe(false);
  });

  test("a Postgres error (SQLSTATE code) is classed as a database error, not 'unreachable'", () => {
    const err = Object.assign(new Error('column "retired_at" does not exist'), { code: "42703" });
    const r = buildErrorReport(err, { path: "/", method: "GET" });
    expect(r.kind).toBe("database_error");
    expect(r.message).toContain("retired_at");
  });

  test("it carries the digest the person saw, the route and method, and nothing from the request body or query", () => {
    const err = Object.assign(new Error("boom"), { digest: "3234606282" });
    const r = buildErrorReport(err, { path: "/loans/abc?token=SECRET&x=1", method: "POST" }, {});
    expect(r.digest).toBe("3234606282");
    expect(r.method).toBe("POST");
    expect(r.route).toBe("/loans/abc");
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });

  test("emails inside messages are masked and long messages are cut", () => {
    const err = new Error(`duplicate key value (email)=(jane.doe@acme.co.ug) ${"x".repeat(1000)}`);
    const r = buildErrorReport(err, { path: "/", method: "GET" });
    expect(r.message).toContain("[email]");
    expect(r.message).not.toContain("jane.doe@acme.co.ug");
    expect(r.message.length).toBeLessThanOrEqual(400);
  });

  describe("forwarding", () => {
    afterEach(() => vi.unstubAllGlobals());

    test("does nothing without a webhook URL", async () => {
      const f = vi.fn();
      vi.stubGlobal("fetch", f);
      await forwardErrorReport(buildErrorReport(new Error("x"), { path: "/", method: "GET" }), undefined);
      expect(f).not.toHaveBeenCalled();
    });

    test("posts a chat-style message with the report", async () => {
      const f = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", f);
      const r = buildErrorReport(Object.assign(new Error("boom"), { digest: "111" }), { path: "/reports", method: "GET" });
      await forwardErrorReport(r, "https://hooks.example/abc");
      expect(f).toHaveBeenCalledTimes(1);
      const body = JSON.parse(f.mock.calls[0][1].body);
      expect(body.text).toContain("ref 111");
      expect(body.content).toBe(body.text); // Discord-style webhooks read `content`
      expect(body.report.route).toBe("/reports");
    });

    test("never throws, even if the webhook is down", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
      await expect(
        forwardErrorReport(buildErrorReport(new Error("x"), { path: "/", method: "GET" }), "https://hooks.example/abc"),
      ).resolves.toBeUndefined();
    });
  });
});
