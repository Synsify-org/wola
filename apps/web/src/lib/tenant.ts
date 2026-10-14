// apps/web/src/lib/tenant.ts
// Server-only tenant context. Every route handler / server component
// that touches tenant data goes through requireTenant() and then
// tenantTx(). No other DB entry point is sanctioned.

import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { makeDb, resolveTenant, tenantTx, type Tx } from "@wola/db";
import { registerEmailFlush } from "./email-flush";
export { tenantTx, type Tx } from "@wola/db";

// One pool per server process (Next dev hot-reload guard).
const globalForDb = globalThis as unknown as { __wolaDb?: ReturnType<typeof makeDb> };
export const db = (globalForDb.__wolaDb ??= makeDb());
registerEmailFlush(db); // mail queued by a request goes out right after it (see email-flush.ts)

export class TenantError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** The organisation behind a subdomain, looked up ONCE per request. A page used to ask for
 *  this about six times (root layout, app layout, the guard twice, the page, the currency);
 *  React's cache() collapses those to a single query for the life of the request. */
export const getTenantBySlug = cache(async (slug: string) => resolveTenant(db, slug));

/** Resolve the current request's tenant or throw. */
export async function requireTenant() {
  const slug = (await headers()).get("x-tenant-slug");
  if (!slug) throw new TenantError(404, "No tenant for apex host");
  const tenant = await getTenantBySlug(slug);
  if (!tenant) throw new TenantError(404, `Unknown or inactive tenant: ${slug}`);
  return tenant;
}

/** The current request's tenant currency code (e.g. "UGX", "KES"). Wrapped
 *  in React's cache() so every Server Component that formats an amount can
 *  call this directly — repeated calls within one request dedupe to a
 *  single resolveTenant() lookup instead of one per caller. */
export const getTenantCurrency = cache(async () => {
  const tenant = await requireTenant();
  return tenant.currency as string;
});

/** Convenience: resolve tenant and run fn inside its RLS-scoped transaction. */
export async function withTenant<T>(fn: (tx: Tx, tenant: Awaited<ReturnType<typeof requireTenant>>) => Promise<T>) {
  const tenant = await requireTenant();
  return tenantTx(db, tenant.id as string, (tx) => fn(tx, tenant));
}
