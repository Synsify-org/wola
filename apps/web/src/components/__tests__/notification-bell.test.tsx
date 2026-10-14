import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import NotificationBell from "../notification-bell";
import type { Notification } from "@wola/db";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
const toastInfo = vi.fn();
vi.mock("sonner", () => ({ toast: { info: (...a: unknown[]) => toastInfo(...a) } }));

// Plain functions behind the mocks (a vi.fn that returns a rejected promise looks
// "unhandled" to the runner).
let load: () => Promise<{ items: Notification[]; unread: number }> = async () => ({ items: [], unread: 0 });
const markOne = vi.fn();
const markAll = vi.fn();
vi.mock("@/app/(app)/notifications/actions", () => ({
  loadNotificationsAction: () => load(),
  markNotificationReadAction: (...a: unknown[]) => markOne(...a),
  markAllNotificationsReadAction: (...a: unknown[]) => markAll(...a),
}));

const n = (id: string, over: Partial<Notification> = {}): Notification => ({
  id, kind: "k", title: `Title ${id}`, body: `Body ${id}`, href: `/loans/${id}`, createdAt: new Date().toISOString(), read: false, ...over,
});

describe("NotificationBell", () => {
  beforeEach(() => {
    push.mockClear(); toastInfo.mockClear();
    markOne.mockReset().mockResolvedValue({ ok: true });
    markAll.mockReset().mockResolvedValue({ ok: true, marked: 2 });
    load = async () => ({ items: [n("a"), n("b")], unread: 2 });
  });
  afterEach(() => { vi.useRealTimers(); });

  test("shows how many are unread, in the badge and for screen readers", () => {
    render(<NotificationBell initialItems={[n("a"), n("b")]} initialUnread={2} />);
    expect(screen.getByRole("button", { name: "Notifications, 2 unread" })).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  test("no badge when everything is read; a big count is capped", () => {
    const { rerender } = render(<NotificationBell initialItems={[]} initialUnread={0} />);
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    rerender(<NotificationBell initialItems={[]} initialUnread={250} />);
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  test("clicking a notification marks it read, lowers the count and goes where it points", async () => {
    render(<NotificationBell initialItems={[n("a"), n("b")]} initialUnread={2} />);
    fireEvent.click(screen.getByRole("button", { name: /notifications, 2 unread/i }));
    fireEvent.click(await screen.findByText("Title a"));
    await waitFor(() => expect(markOne).toHaveBeenCalledWith("a"));
    expect(push).toHaveBeenCalledWith("/loans/a");
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeInTheDocument();
  });

  test("mark all read clears the count", async () => {
    render(<NotificationBell initialItems={[n("a"), n("b")]} initialUnread={2} />);
    fireEvent.click(screen.getByRole("button", { name: /notifications, 2 unread/i }));
    fireEvent.click(await screen.findByRole("button", { name: /mark all read/i }));
    await waitFor(() => expect(markAll).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });

  test("an empty list says you're all caught up", async () => {
    load = async () => ({ items: [], unread: 0 });
    render(<NotificationBell initialItems={[]} initialUnread={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view all notifications/i })).toHaveAttribute("href", "/notifications");
  });

  test("a new notification arriving while the page is open pops a toast, once", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<NotificationBell initialItems={[n("a")]} initialUnread={1} />);
    load = async () => ({ items: [n("new", { title: "Awaiting your decision", body: "Brenda: Development Loan" }), n("a")], unread: 2 });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await waitFor(() => expect(toastInfo).toHaveBeenCalledTimes(1));
    expect(toastInfo.mock.calls[0][0]).toBe("Awaiting your decision");
    expect(screen.getByRole("button", { name: "Notifications, 2 unread" })).toBeInTheDocument();
    // The next check sees the same notification: no second toast.
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(toastInfo).toHaveBeenCalledTimes(1);
  });

  test("a failed check (offline) changes nothing and doesn't crash", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<NotificationBell initialItems={[n("a")]} initialUnread={1} />);
    load = () => Promise.reject(new Error("offline"));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeInTheDocument();
    expect(toastInfo).not.toHaveBeenCalled();
  });
});
