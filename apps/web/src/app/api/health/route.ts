// GET /api/health — is Wola up, and can it reach its database?
//
// Built for an uptime monitor: it works on ANY host (the bare domain or a tenant's
// subdomain, no tenant lookup involved) and says nothing about any organisation: no
// names, no counts. 200 {"ok":true} when the database answers; 503 {"ok":false} when
// it does not. Never cached.
//
// It also reports HOW FAST, in response headers (the body stays {"ok":true}):
//   Server-Timing: db-first;dur=…  the first query, which includes opening the connection
//                  db-rtt;dur=…    a second query on the now-open connection: the pure
//                                  round-trip to the database. Every query a page runs
//                                  costs about this much, so pages ≈ queries × db-rtt.
//   X-Wola-Region: where the server runs (Vercel's region code) — should be next to the database.
//   X-Wola-Instance-Age: seconds since this server instance started (small = a cold start).
// Read them with:  curl -D - https://<site>/api/health
import { NextResponse } from "next/server";
import { db } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const bootedAt = Date.now();
const ms = (from: number) => Math.round(performance.now() - from);

async function check() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = performance.now();
  try {
    await Promise.race([
      db`SELECT 1`,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 5000); }),
    ]);
    const first = ms(started);
    const t1 = performance.now();
    await db`SELECT 1`;
    const rtt = ms(t1);
    return NextResponse.json({ ok: true }, {
      headers: {
        "cache-control": "no-store",
        "server-timing": `db-first;dur=${first}, db-rtt;dur=${rtt}`,
        "x-wola-region": process.env.VERCEL_REGION ?? "local",
        "x-wola-instance-age": String(Math.round((Date.now() - bootedAt) / 1000)),
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503, headers: { "cache-control": "no-store" } });
  } finally {
    clearTimeout(timer);
  }
}

export const GET = check;
export const HEAD = check;
