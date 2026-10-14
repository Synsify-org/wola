// packages/db/src/inapp.ts
// In-app notifications: the bell in the top bar. One row per person per event.
//
// They are written by the same code that already sends the email for an event and in
// the same transaction (see notifications.ts), so an event and its notification commit or
// roll back together. Reading is always scoped to ONE person: every query here takes the
// signed-in user's id, so nobody can read a colleague's notifications, and the database's
// tenant rules keep one organisation's out of another's.
import type { Tx } from "./client";

export interface NotificationInput {
  /** Short machine-readable type, e.g. "application.awaiting". */
  kind: string;
  title: string;
  body?: string | null;
  /** In-app path only ("/loans/…"); anything else is dropped rather than stored. */
  href?: string | null;
}

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  createdAt: string;
  read: boolean;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
/** Only an in-app path is allowed (matches the table's CHECK). */
const safeHref = (h: string | null | undefined) => (h && /^\/($|[^/\\])/.test(h) ? h : null);

/** Notify specific people. Duplicate and empty ids are ignored. Returns how many rows
 *  were written. */
export async function notifyUsers(
  tx: Tx, tenantId: string, userIds: (string | null | undefined)[], n: NotificationInput,
): Promise<number> {
  const ids = [...new Set(userIds.filter((u): u is string => Boolean(u)))];
  if (ids.length === 0) return 0;
  const title = clip(n.title.trim(), 160);
  if (!title) return 0;
  const body = n.body ? clip(n.body.trim(), 500) : null;
  const href = safeHref(n.href);
  for (const userId of ids) {
    await tx`
      INSERT INTO notifications (tenant_id, user_id, kind, title, body, href)
      VALUES (${tenantId}, ${userId}, ${n.kind}, ${title}, ${body}, ${href})`;
  }
  return ids.length;
}

/** The people holding any of `roles` in this organisation (active accounts only). */
export async function userIdsForRoles(tx: Tx, tenantId: string, roles: readonly string[]): Promise<string[]> {
  if (roles.length === 0) return [];
  const rows = await tx`
    SELECT DISTINCT m.user_id FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = ${tenantId} AND m.role = ANY(${roles as string[]}) AND u.status = 'active'`;
  return rows.map((r) => r.user_id as string);
}

/** Notify everyone holding one of `roles`, except (optionally) the person who caused it. */
export async function notifyRoles(
  tx: Tx, tenantId: string, roles: readonly string[], n: NotificationInput, opts: { exceptUserId?: string | null } = {},
): Promise<number> {
  const ids = (await userIdsForRoles(tx, tenantId, roles)).filter((u) => u !== opts.exceptUserId);
  return notifyUsers(tx, tenantId, ids, n);
}

/** The login behind an employee record (null if that employee has no login). */
export async function userIdForEmployee(tx: Tx, employeeId: string | null | undefined): Promise<string | null> {
  if (!employeeId) return null;
  const [r] = await tx`SELECT user_id FROM employees WHERE id = ${employeeId}`;
  return (r?.user_id as string | null) ?? null;
}

/** The borrower's login for a loan, plus what is needed to word a message about it. */
export async function loanBorrower(
  tx: Tx, tenantId: string, loanId: string,
): Promise<{ userId: string | null; name: string; product: string } | null> {
  const [r] = await tx`
    SELECT e.user_id, e.full_name, lp.name AS product
    FROM loans l
    JOIN loan_applications la ON la.id = l.application_id
    JOIN employees e ON e.id = la.employee_id
    JOIN loan_products lp ON lp.id = la.loan_product_id
    WHERE l.tenant_id = ${tenantId} AND l.id = ${loanId}`;
  return r ? { userId: (r.user_id as string | null) ?? null, name: r.full_name as string, product: r.product as string } : null;
}

const map = (r: Record<string, unknown>): Notification => ({
  id: r.id as string,
  kind: r.kind as string,
  title: r.title as string,
  body: (r.body as string | null) ?? null,
  href: (r.href as string | null) ?? null,
  createdAt: new Date(r.created_at as string).toISOString(),
  read: r.read_at !== null,
});

/** The person's notifications, newest first, plus how many are still unread. */
export async function listNotifications(
  tx: Tx, tenantId: string, userId: string, opts: { limit?: number; unreadOnly?: boolean } = {},
): Promise<{ items: Notification[]; unread: number }> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 20), 1), 100);
  const rows = await tx`
    SELECT id, kind, title, body, href, created_at, read_at FROM notifications
    WHERE tenant_id = ${tenantId} AND user_id = ${userId}
      AND (${opts.unreadOnly ?? false} = false OR read_at IS NULL)
    ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
  return { items: rows.map(map), unread: await unreadCount(tx, tenantId, userId) };
}

export async function unreadCount(tx: Tx, tenantId: string, userId: string): Promise<number> {
  const [r] = await tx`
    SELECT count(*)::int AS n FROM notifications
    WHERE tenant_id = ${tenantId} AND user_id = ${userId} AND read_at IS NULL`;
  return Number(r?.n ?? 0);
}

/** Mark ONE notification read. Only the owner's own row can change. */
export async function markNotificationRead(
  tx: Tx, args: { tenantId: string; userId: string; id: string },
): Promise<boolean> {
  const res = await tx`
    UPDATE notifications SET read_at = now()
    WHERE tenant_id = ${args.tenantId} AND user_id = ${args.userId} AND id = ${args.id} AND read_at IS NULL
    RETURNING id`;
  return res.length > 0;
}

export async function markAllNotificationsRead(
  tx: Tx, args: { tenantId: string; userId: string },
): Promise<number> {
  const res = await tx`
    UPDATE notifications SET read_at = now()
    WHERE tenant_id = ${args.tenantId} AND user_id = ${args.userId} AND read_at IS NULL
    RETURNING id`;
  return res.length;
}
