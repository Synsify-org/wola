"use client";
// The bell in the top bar: how many things are waiting for me, and the latest few.
//
//  - The count and first page come from the server with the page (no flash of "0").
//  - While the tab is visible it re-checks every minute, and when something NEW arrives
//    it also pops a toast ("Awaiting your decision") so it isn't missed. When the tab was
//    hidden it re-checks the moment it becomes visible again.
//  - Clicking a notification marks it read and goes where it points. "Mark all read"
//    clears the count.
// No websockets: a once-a-minute check is cheap, works through any proxy, and is plenty
// for loan approvals.
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Bell, CheckCheck, Inbox } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Notification } from "@wola/db";
import { loadNotificationsAction, markAllNotificationsReadAction, markNotificationReadAction } from "@/app/(app)/notifications/actions";
import { timeAgo } from "@/lib/time-ago";

const POLL_MS = 60_000;

export default function NotificationBell({
  initialItems, initialUnread,
}: { initialItems: Notification[]; initialUnread: number }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  // When the server sends fresh data (a refresh after an action), take it.
  useEffect(() => { setItems(initialItems); setUnread(initialUnread); }, [initialItems, initialUnread]);
  // Ids already shown (in the list or as a toast), so a poll only announces what is new.
  const seen = useRef(new Set(initialItems.map((n) => n.id)));

  const refresh = useCallback(async (announce: boolean) => {
    try {
      const v = await loadNotificationsAction(10);
      if (announce) {
        const fresh = v.items.filter((n) => !n.read && !seen.current.has(n.id));
        if (fresh.length === 1) {
          const n = fresh[0];
          toast.info(n.title, { id: `n-${n.id}`, description: n.body ?? undefined, action: n.href ? { label: "Open", onClick: () => router.push(n.href!) } : undefined });
        } else if (fresh.length > 1) {
          toast.info(`${fresh.length} new notifications`, { id: "n-many", description: fresh[0].title });
        }
      }
      v.items.forEach((n) => seen.current.add(n.id));
      setItems(v.items);
      setUnread(v.unread);
    } catch {
      /* offline or signed out: the next poll tries again */
    }
  }, [router]);

  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") void refresh(true); };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [refresh]);

  const openItem = (n: Notification) => {
    setOpen(false);
    if (!n.read) {
      setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      start(async () => { await markNotificationReadAction(n.id); });
    }
    if (n.href) router.push(n.href);
  };

  const markAll = () => {
    setItems((cur) => cur.map((x) => ({ ...x, read: true })));
    setUnread(0);
    start(async () => { await markAllNotificationsReadAction(); });
  };

  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) void refresh(false); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full border border-rule bg-surface text-ink-soft transition-all duration-150 hover:bg-paper hover:text-ink active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Bell className="h-5 w-5" aria-hidden />
          {unread > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-[1.125rem] place-items-center rounded-full bg-rejected px-1 text-[0.6875rem] font-semibold leading-[1.125rem] text-white ring-2 ring-surface">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(22rem,calc(100vw-1.5rem))] gap-0 rounded-2xl border border-rule bg-surface p-0 text-ink shadow-theme-lg ring-0">
        <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
          <h2 className="text-sm font-semibold">Notifications</h2>
          <button type="button" onClick={markAll} disabled={unread === 0}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline disabled:cursor-not-allowed disabled:text-ink-faint disabled:no-underline">
            <CheckCheck className="h-3.5 w-3.5" aria-hidden /> Mark all read
          </button>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-paper text-ink-faint"><Inbox className="h-5 w-5" aria-hidden /></span>
            <p className="text-sm font-medium">You&apos;re all caught up</p>
            <p className="text-xs text-ink-soft">Decisions waiting for you and updates on your loans show up here.</p>
          </div>
        ) : (
          <ul className="max-h-[22rem] divide-y divide-rule overflow-y-auto">
            {items.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => openItem(n)}
                  className={"flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-paper focus-visible:bg-paper focus-visible:outline-none " + (n.read ? "" : "bg-brand-wash")}>
                  <span className={"mt-1.5 h-2 w-2 shrink-0 rounded-full " + (n.read ? "bg-transparent" : "bg-brand")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={"block text-sm " + (n.read ? "text-ink-soft" : "font-medium text-ink")}>{n.title}</span>
                    {n.body ? <span className="mt-0.5 line-clamp-2 block text-xs text-ink-soft">{n.body}</span> : null}
                    <span className="mt-1 block text-[0.6875rem] text-ink-faint">{timeAgo(n.createdAt)}</span>
                  </span>
                  {n.read ? null : <span className="sr-only">Unread</span>}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-rule px-4 py-2.5 text-center">
          <Link href="/notifications" onClick={() => setOpen(false)} className="text-xs font-medium text-brand hover:underline">View all notifications</Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
