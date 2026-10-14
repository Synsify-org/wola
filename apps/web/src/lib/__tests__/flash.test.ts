import { describe, test, expect, beforeEach } from "vitest";
import { describeFlash, reasonToFlashCode, setFlash, takeFlash, FLASH_COOKIE } from "../flash";
import { timeAgo } from "../time-ago";

describe("flash messages", () => {
  beforeEach(() => { document.cookie = `${FLASH_COOKIE}=; path=/; max-age=0`; });

  test("only codes in the fixed vocabulary produce a message; anything else is ignored", () => {
    expect(describeFlash("signed-in", "Daniel Ssebunya")).toEqual({ kind: "success", title: "Signed in", description: "Welcome back, Daniel." });
    expect(describeFlash("signed-in")?.description).toBe("Welcome back.");
    expect(describeFlash("signed-out")?.kind).toBe("info");
    expect(describeFlash("session-expired")?.kind).toBe("warning");
    expect(describeFlash("<script>alert(1)</script>")).toBeNull();
    expect(describeFlash("You won a prize")).toBeNull();
    expect(describeFlash(null)).toBeNull();
  });

  test("a name never changes the wording beyond the greeting", () => {
    expect(describeFlash("signed-in", "  Grace   Namuli ")?.description).toBe("Welcome back, Grace.");
  });

  test("the cookie is taken once: read, then gone", () => {
    setFlash("signed-out");
    expect(takeFlash()).toBe("signed-out");
    expect(takeFlash()).toBeNull();
  });

  test("?reason= maps into the same vocabulary", () => {
    expect(reasonToFlashCode("expired")).toBe("session-expired");
    expect(reasonToFlashCode("reset")).toBe("password-reset");
    expect(reasonToFlashCode("anything-else")).toBeNull();
    expect(reasonToFlashCode(null)).toBeNull();
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  test("plain, short wording", () => {
    expect(timeAgo(ago(10_000), now)).toBe("just now");
    expect(timeAgo(ago(5 * 60_000), now)).toBe("5 min ago");
    expect(timeAgo(ago(3 * 3600_000), now)).toBe("3 h ago");
    expect(timeAgo(ago(26 * 3600_000), now)).toBe("yesterday");
    expect(timeAgo(ago(4 * 86400_000), now)).toBe("4 days ago");
  });

  test("a clock slightly ahead of the server never shows a negative time", () => {
    expect(timeAgo(new Date(now.getTime() + 60_000).toISOString(), now)).toBe("just now");
  });
});
