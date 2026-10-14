// apps/web/src/app/(app)/layout.tsx
// Shared chrome for every authenticated tenant page — sidebar, topbar,
// mobile nav. Previously each page computed `user` itself and rendered
// <Shell> around its own content (identical ~15-line block duplicated
// across ~13 pages). Moving it here means Shell persists across
// navigations instead of unmounting/remounting on every page load, and —
// the actual point — a route-level loading.tsx can finally show INSIDE
// Shell's content area instead of replacing the whole page (sidebar
// included) with a bare fallback, which is what blocked adding one before.
import { headers } from "next/headers";
import { requireSession } from "@/lib/guard";
import { listNotifications } from "@wola/db";
import { db, getTenantBySlug } from "@/lib/tenant";
import Shell from "@/components/shell";
import AuthFlash from "@/components/auth-flash";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const slug = (await headers()).get("x-tenant-slug") ?? "";
  const tenant = slug ? await getTenantBySlug(slug) : null;

  const { user, notifications } = await requireSession(async (tx, ctx) => {
    const [me] = await tx`
      SELECT e.full_name, u.email
      FROM users u LEFT JOIN employees e ON e.user_id = u.id
      WHERE u.id = ${ctx.userId}`;
    return {
      user: {
        name: (me?.full_name as string) ?? (me?.email as string) ?? "User",
        email: (me?.email as string) ?? "",
        role: ctx.role,
        canSeeAllLoans: ctx.canSeeAllLoans,
        canApprove: ctx.canApprove,
      },
      // My latest notifications for the bell, so the count is right on first paint.
      notifications: await listNotifications(tx, ctx.tenantId, ctx.userId, { limit: 10 }),
    };
    // The layout only draws the shell. The two-step-sign-in gate is enforced by
    // each page and action (see requireSession); gating here too would bounce
    // the setup page into a redirect loop.
  }, { skipMfaGate: true });

  return (
    <Shell user={user} tenantName={(tenant?.name as string) ?? "Wola"} notifications={notifications}>
      {children}
      {/* "Signed in. Welcome back, …" after a successful sign-in. */}
      <AuthFlash name={user.name} />
    </Shell>
  );
}
