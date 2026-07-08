// apps/web/src/lib/guard.ts — call at the top of any protected page/route.
import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveTenant, tenantTx, type Tx } from "@wola/db";
import { db } from "./tenant";
import { verifySession, SESSION_COOKIE } from "./auth";

/** Require a valid session for the CURRENT tenant. Redirects to /login
 *  on any failure. Returns tenant + userId and runs fn in RLS scope. */
export async function requireSession<T>(
  fn: (tx: Tx, ctx: { tenantId: string; userId: string }) => Promise<T>,
): Promise<T> {
  const slug = (await headers()).get("x-tenant-slug");
  if (!slug) redirect("/login");
  const tenant = await resolveTenant(db, slug);
  if (!tenant) redirect("/login");

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token, tenant.id as string);
  if (!session) redirect("/login");

  return tenantTx(db, tenant.id as string, (tx) =>
    fn(tx, { tenantId: tenant.id as string, userId: session.userId }));
}