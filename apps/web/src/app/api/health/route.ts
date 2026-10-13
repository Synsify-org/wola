// GET /api/health — is Wola up, and can it reach its database?
//
// Built for an uptime monitor: it works on ANY host (the bare domain or a tenant's
// subdomain, no tenant lookup involved) and says nothing about any organisation: no
// names, no counts. 200 {"ok":true} when the database answers; 503 {"ok":false} when
// it does not. Never cached.
import { NextResponse } from "next/server";
import { db } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };

async function check() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db`SELECT 1`,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 5000); }),
    ]);
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503, headers });
  } finally {
    clearTimeout(timer);
  }
}

export const GET = check;
export const HEAD = check;
