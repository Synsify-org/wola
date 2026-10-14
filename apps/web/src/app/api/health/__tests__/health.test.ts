import { describe, test, expect, vi, beforeEach } from "vitest";

// A plain function, not vi.fn(): vitest attaches its own handler to a promise a mock
// returns, which makes a deliberately rejected query look "unhandled" to the runner.
let query: () => Promise<unknown> = async () => [{ "?column?": 1 }];
vi.mock("@/lib/tenant", () => ({ db: () => query() }));

// The retry sweep for queued email is triggered through after(); record that it was asked for,
// without sending anything.
const swept: string[] = [];
vi.mock("@/lib/email-flush", () => ({ sweepWaitingEmails: async () => { swept.push("swept"); } }));
const afterCallbacks: Array<() => unknown> = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { afterCallbacks.push(fn); } }));

import { GET } from "../route";

describe("GET /api/health", () => {
  beforeEach(() => { query = async () => [{ "?column?": 1 }]; swept.length = 0; afterCallbacks.length = 0; });

  test("200 and nothing about any organisation when the database answers", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("reports how fast the database is, in headers only (the body stays {ok:true})", async () => {
    const res = await GET();
    expect(res.headers.get("server-timing")).toMatch(/^db-first;dur=\d+, db-rtt;dur=\d+$/);
    expect(res.headers.get("x-wola-region")).toBe("local");
    expect(Number(res.headers.get("x-wola-instance-age"))).toBeGreaterThanOrEqual(0);
    expect(Object.keys(await res.json())).toEqual(["ok"]);
  });

  test("a healthy check also asks for the queued-email retry sweep, after the response; an unhealthy one does not", async () => {
    await GET();
    expect(afterCallbacks).toHaveLength(1);
    expect(swept).toEqual([]); // nothing runs before the response goes out
    await afterCallbacks[0]();
    expect(swept).toEqual(["swept"]);

    afterCallbacks.length = 0;
    query = () => Promise.reject(new Error("down"));
    await GET();
    expect(afterCallbacks).toHaveLength(0);
  });

  test("503 when the database does not answer, without leaking internals", async () => {
    query = () => Promise.reject(new Error("connect ECONNREFUSED"));
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
  });
});
