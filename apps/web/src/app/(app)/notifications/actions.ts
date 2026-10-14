"use server";
// The bell's server side: read my notifications, mark one or all read. Every call is
// scoped to the signed-in person (ctx.userId), so nobody can read or change a colleague's.
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/guard";
import { listNotifications, markAllNotificationsRead, markNotificationRead, type Notification } from "@wola/db";

export type NotificationsView = { items: Notification[]; unread: number };

/** My latest notifications (the bell polls this while the tab is visible). */
export async function loadNotificationsAction(limit = 10): Promise<NotificationsView> {
  return requireSession((tx, ctx) => listNotifications(tx, ctx.tenantId, ctx.userId, { limit }));
}

export async function markNotificationReadAction(id: string): Promise<{ ok: boolean }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false };
  return requireSession(async (tx, ctx) => {
    const ok = await markNotificationRead(tx, { tenantId: ctx.tenantId, userId: ctx.userId, id });
    revalidatePath("/notifications");
    return { ok };
  });
}

export async function markAllNotificationsReadAction(): Promise<{ ok: true; marked: number }> {
  return requireSession(async (tx, ctx) => {
    const marked = await markAllNotificationsRead(tx, { tenantId: ctx.tenantId, userId: ctx.userId });
    revalidatePath("/notifications");
    return { ok: true as const, marked };
  });
}
