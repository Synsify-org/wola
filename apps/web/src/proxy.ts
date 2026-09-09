// apps/web/src/proxy.ts
// Runs on every request. Edge runtime => NO database access here.
// Job: parse the subdomain against the configured base domain, reject
// garbage early, pass the slug to server code via a request header.
// Actual tenant lookup (DB + Redis cache) lives in lib/tenant.ts.
//
// TWO DEPLOYMENT MODES, chosen by env — ONE codebase, no fork:
//
//   SaaS (default): tenant comes from the subdomain. Many companies share the
//     deployment, each on their own subdomain, isolated by RLS.
//       testco.wola.app -> slug "testco"
//
//   On-prem / single-tenant: set WOLA_SINGLE_TENANT=<slug>. EVERY request is
//     pinned to that one tenant regardless of host, because a client's own
//     server has no subdomains — it's one company at whatever URL their IT
//     assigns. The RLS multi-tenant machinery still runs; it just always
//     resolves to the single tenant. This is how the SAME platform deploys to
//     a client's infrastructure without a code fork. Paired with
//     scripts/onboard-tenant.mjs, which provisions that one tenant + admin.

import { NextRequest, NextResponse } from "next/server";

// On-prem single-tenant pin. When set, every request is pinned to this slug
// and host parsing below is skipped entirely. Unset for SaaS deployments.
const SINGLE_TENANT_SLUG = process.env.WOLA_SINGLE_TENANT || null;

// The one source of truth for host parsing. localhost in dev,
// wola.app (or whatever clears URSB) in production.
const BASE = (process.env.WOLA_BASE_DOMAIN ?? "localhost").toLowerCase();

// Mirror of the DB slug_reserved constraint (DB remains source of truth).
const RESERVED = new Set([
  "www", "app", "api", "admin", "docs", "status", "mail", "staging",
  "assets", "cdn", "auth", "billing", "support", "demo",
]);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

export function proxy(req: NextRequest) {
  const headers = new Headers(req.headers);

  // On-prem: pin to the single tenant, ignore the host entirely.
  if (SINGLE_TENANT_SLUG) {
    headers.set("x-tenant-slug", SINGLE_TENANT_SLUG);
    return NextResponse.next({ request: { headers } });
  }

  const host = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();

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
