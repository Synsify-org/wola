// apps/web/src/lib/super-admin-guard.ts — call at the top of any /admin/*
// page. Mirrors lib/guard.ts's requireSession(), but there's no tenant
// context to establish here at all — the super-admin surface sits outside
// the tenant model entirely (see migration 0014's header), so pages call the
// cross-tenant DB functions directly on the plain connection, no tenantTx.
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySuperSession, SUPER_SESSION_COOKIE } from "./super-admin-auth";

export interface SuperAdminCtx {
  userId: string;
}

export async function requireSuperSession<T>(
  fn: (ctx: SuperAdminCtx) => Promise<T>,
): Promise<T> {
  const token = (await cookies()).get(SUPER_SESSION_COOKIE)?.value;
  const session = await verifySuperSession(token);
  if (!session) redirect("/admin/login");
  return fn({ userId: session.userId });
}
