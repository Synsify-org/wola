import { describe, test, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import Shell from "../shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
  useLinkStatus: () => ({ pending: false }),
}));

// The bell (in the top bar) calls server actions; they aren't loadable in a unit test.
vi.mock("@/app/(app)/notifications/actions", () => ({
  loadNotificationsAction: async () => ({ items: [], unread: 0 }),
  markNotificationReadAction: async () => ({ ok: true }),
  markAllNotificationsReadAction: async () => ({ ok: true, marked: 0 }),
}));

// jsdom can't measure layout, so this pins the two classes the fix depends on.
// Without `relative`, absolutely-positioned descendants (sr-only labels, chart
// tooltip wrappers) escape the frame's clipping and stretch the DOCUMENT taller
// than the window; it then scrolls and carries the whole app up, leaving a blank
// band under the sidebar (seen on the CFO dashboard). See shell.tsx.
describe("Shell frame", () => {
  test("contains its descendants: positioned and clipped, so only <main> scrolls", () => {
    const { container } = render(
      <Shell
        user={{ name: "T", email: "t@x.io", role: "cfo", canSeeAllLoans: true, canApprove: true }}
        tenantName="Test Co"
      >
        <p>content</p>
      </Shell>,
    );
    const frame = container.querySelector(".app-frame")!;
    expect(frame.className).toMatch(/\brelative\b/);
    expect(frame.className).toMatch(/\boverflow-clip\b/);
    expect(frame.className).not.toMatch(/\boverflow-hidden\b/);
  });
});
