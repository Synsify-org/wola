// apps/web/middleware.ts
// Resolves the tenant from the subdomain and hands it to the app as the
// x-tenant-slug header. Every server component reads that header (see
// lib/tenant.ts requireTenant() and lib/guard.ts requireSession()).
//
// Host shapes handled:
//   testco.localhost:3000   -> slug "testco"      (local dev, real subdomain)
//   testco.wola.africa      -> slug "testco"      (production)
//   localhost:3000          -> DEV_FALLBACK_SLUG  (so plain localhost works)
//   wola.africa / www.      -> no slug (apex/marketing; app 404s tenant pages)
import { NextRequest, NextResponse } from "next/server";

// In dev, plain localhost with no subdomain falls back to this tenant so you
// don't have to fight *.localhost DNS while building. Unset in production.
const DEV_FALLBACK_SLUG =
  process.env.NODE_ENV === "development" ? "testco" : null;

// Hosts that are the apex / marketing site, never a tenant.
const RESERVED = new Set(["www", "app", "api", "admin"]);

function slugFromHost(host: string | null): string | null {
  if (!host) return null;
  // strip port
  const hostname = host.split(":")[0]; // testco.localhost
  const parts = hostname.split(".");

  // localhost with no subdomain  -> ["localhost"]
  // testco.localhost             -> ["testco","localhost"]
  // testco.wola.africa           -> ["testco","wola","africa"]
  // wola.africa                  -> ["wola","africa"]
  const isLocal = parts[parts.length - 1] === "localhost";

  if (isLocal) {
    if (parts.length >= 2) return parts[0];   // testco.localhost -> testco
    return DEV_FALLBACK_SLUG;                  // localhost -> fallback
  }

  // Production: subdomain exists only if there are 3+ labels (sub.domain.tld)
  if (parts.length >= 3) {
    const sub = parts[0];
    return RESERVED.has(sub) ? null : sub;
  }
  // apex like wola.africa -> no tenant
  return null;
}

export function middleware(req: NextRequest) {
  const slug = slugFromHost(req.headers.get("host"));

  const requestHeaders = new Headers(req.headers);
  if (slug) {
    requestHeaders.set("x-tenant-slug", slug);
  } else {
    requestHeaders.delete("x-tenant-slug"); // ensure no stale value
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

// Run on everything except static assets and Next internals.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};