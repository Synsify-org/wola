"use client";
// The full notifications list (the "View all" page): same behaviour as the bell, with room.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Inbox } from "lucide-react";
import type { Notification } from "@wola/db";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/app/(app)/notifications/actions";
import { timeAgo } from "@/lib/time-ago";

export default function NotificationList({ initialItems }: { initialItems: Notification[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [, start] = useTransition();
  const unread = items.filter((n) => !n.read).length;

  const open = (n: Notification) => {
    if (!n.read) {
      setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      start(async () => { await markNotificationReadAction(n.id); router.refresh(); });
    }
    if (n.href) router.push(n.href);
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-rule bg-surface px-6 py-16 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-paper text-ink-faint"><Inbox className="h-6 w-6" aria-hidden /></span>
        <p className="font-medium text-ink">You&apos;re all caught up</p>
        <p className="max-w-sm text-sm text-ink-soft">Decisions waiting for you and updates on your loans will show up here.</p>
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-rule bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3">
        <p className="text-sm text-ink-soft">{unread > 0 ? `${unread} unread` : "Everything is read"}</p>
        <button type="button" disabled={unread === 0}
          onClick={() => { setItems((cur) => cur.map((x) => ({ ...x, read: true }))); start(async () => { await markAllNotificationsReadAction(); router.refresh(); }); }}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline disabled:cursor-not-allowed disabled:text-ink-faint disabled:no-underline">
          <CheckCheck className="h-4 w-4" aria-hidden /> Mark all read
        </button>
      </div>
      <ul className="divide-y divide-rule">
        {items.map((n) => (
          <li key={n.id}>
            <button type="button" onClick={() => open(n)}
              className={"flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-paper focus-visible:bg-paper focus-visible:outline-none " + (n.read ? "" : "bg-brand-wash")}>
              <span className={"mt-2 h-2 w-2 shrink-0 rounded-full " + (n.read ? "bg-transparent" : "bg-brand")} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className={"block " + (n.read ? "text-ink-soft" : "font-medium text-ink")}>{n.title}</span>
                {n.body ? <span className="mt-0.5 block text-sm text-ink-soft">{n.body}</span> : null}
              </span>
              <span className="shrink-0 text-xs text-ink-faint">{timeAgo(n.createdAt)}</span>
              {n.read ? null : <span className="sr-only">Unread</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
