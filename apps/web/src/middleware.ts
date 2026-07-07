// apps/web/src/middleware.ts
// Runs on every request. Edge runtime => NO database access here.
// Job: parse the subdomain against the configured base domain, reject
// garbage early, pass the slug to server code via a request header.
// Actual tenant lookup (DB + Redis cache) lives in lib/tenant.ts.

import { NextRequest, NextResponse } from "next/server";

// The one source of truth for host parsing. localhost in dev,
// wola.app (or whatever clears URSB) in production.
const BASE = (process.env.WOLA_BASE_DOMAIN ?? "localhost").toLowerCase();

// Mirror of the DB slug_reserved constraint (DB remains source of truth).
const RESERVED = new Set([
  "www", "app", "api", "admin", "docs", "status", "mail", "staging",
  "assets", "cdn", "auth", "billing", "support", "demo",
]);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  const headers = new Headers(req.headers);

  if (host === BASE || host === `www.${BASE}`) {
    headers.set("x-tenant-slug", "");            // apex => marketing/entry
    return NextResponse.next({ request: { headers } });
  }

  if (!host.endsWith(`.${BASE}`)) {
    return new NextResponse("Not found", { status: 404 }); // foreign host
  }

  const slug = host.slice(0, -(BASE.length + 1));
  if (slug.includes(".") || RESERVED.has(slug) || !SLUG_RE.test(slug)) {
    return new NextResponse("Not found", { status: 404 });
  }

  headers.set("x-tenant-slug", slug);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
