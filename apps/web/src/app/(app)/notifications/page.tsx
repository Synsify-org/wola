// All my notifications (the bell shows the latest few). Everyone has this page: it only
// ever shows the signed-in person's own.
import { requireSession } from "@/lib/guard";
import { listNotifications } from "@wola/db";
import NotificationList from "@/components/notification-list";
import { pageMeta } from "@/lib/site";

export const metadata = pageMeta({ title: "Notifications", description: "Decisions waiting for you and updates on your loans.", path: "/notifications" });

export default async function NotificationsPage() {
  const { items } = await requireSession((tx, ctx) => listNotifications(tx, ctx.tenantId, ctx.userId, { limit: 50 }));
  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink">Notifications</h1>
        <p className="mt-1 text-sm text-ink-soft">Decisions waiting for you and updates on your loans. The latest 50.</p>
      </div>
      <div className="max-w-3xl">
        <NotificationList initialItems={items} />
      </div>
    </>
  );
}
