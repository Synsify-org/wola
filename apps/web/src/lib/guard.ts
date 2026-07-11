// apps/web/src/lib/guard.ts — call at the top of any protected page/route.
import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveTenant, tenantTx, type Tx } from "@wola/db";
import { db } from "./tenant";
import { verifySession, SESSION_COOKIE } from "./auth";

/** Roles allowed to see ALL loans in the tenant. Everyone else sees only
 *  their own. Fail closed: an unknown role gets employee-level access. */
const ADMIN_ROLES = ["cfo", "hr", "ceo", "md", "coo", "dept_head", "admin"];

export type SessionCtx = {
  tenantId: string;
  userId: string;
  role: string;
  canSeeAllLoans: boolean;
};

/** Require a valid session for the CURRENT tenant. Redirects to /login
 *  on any failure. Returns tenant + userId + role, runs fn in RLS scope. */
export async function requireSession<T>(
  fn: (tx: Tx, ctx: SessionCtx) => Promise<T>,
): Promise<T> {
  const slug = (await headers()).get("x-tenant-slug");
  if (!slug) redirect("/login");
  const tenant = await resolveTenant(db, slug);
  if (!tenant) redirect("/login");

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token, tenant.id as string);
  if (!session) redirect("/login");

  return tenantTx(db, tenant.id as string, async (tx) => {
    // Role comes from the membership in THIS tenant.
    const [m] = await tx`
      SELECT role FROM memberships
      WHERE user_id = ${session.userId} AND tenant_id = ${tenant.id}`;
    const role = (m?.role as string) ?? "employee";
    return fn(tx, {
      tenantId: tenant.id as string,
      userId: session.userId,
      role,
      canSeeAllLoans: ADMIN_ROLES.includes(role),
    });
  });
}