// apps/web/src/lib/tenant.ts
// Server-only tenant context. Every route handler / server component
// that touches tenant data goes through requireTenant() and then
// tenantTx(). No other DB entry point is sanctioned.

import "server-only";
import { headers } from "next/headers";
import { makeDb, resolveTenant, tenantTx, type Tx } from "@wola/db";
export { tenantTx, type Tx } from "@wola/db";

// One pool per server process (Next dev hot-reload guard).
const globalForDb = globalThis as unknown as { __wolaDb?: ReturnType<typeof makeDb> };
export const db = (globalForDb.__wolaDb ??= makeDb());

export class TenantError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Resolve the current request's tenant or throw. TODO: Redis cache with short TTL. */
export async function requireTenant() {
  const slug = (await headers()).get("x-tenant-slug");
  if (!slug) throw new TenantError(404, "No tenant for apex host");
  const tenant = await resolveTenant(db, slug);
  if (!tenant) throw new TenantError(404, `Unknown or inactive tenant: ${slug}`);
  return tenant;
}

/** Convenience: resolve tenant and run fn inside its RLS-scoped transaction. */
export async function withTenant<T>(fn: (tx: Tx, tenant: Awaited<ReturnType<typeof requireTenant>>) => Promise<T>) {
  const tenant = await requireTenant();
  return tenantTx(db, tenant.id as string, (tx) => fn(tx, tenant));
}
