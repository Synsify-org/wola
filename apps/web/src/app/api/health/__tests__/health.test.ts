import { describe, test, expect, vi, beforeEach } from "vitest";

// A plain function, not vi.fn(): vitest attaches its own handler to a promise a mock
// returns, which makes a deliberately rejected query look "unhandled" to the runner.
let query: () => Promise<unknown> = async () => [{ "?column?": 1 }];
vi.mock("@/lib/tenant", () => ({ db: () => query() }));

import { GET } from "../route";

describe("GET /api/health", () => {
  beforeEach(() => { query = async () => [{ "?column?": 1 }]; });

  test("200 and nothing about any organisation when the database answers", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
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
