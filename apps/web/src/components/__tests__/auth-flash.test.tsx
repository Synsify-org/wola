import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import AuthFlash from "../auth-flash";
import { setFlash, takeFlash, FLASH_COOKIE } from "@/lib/flash";

const success = vi.fn();
const info = vi.fn();
const warning = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => success(...a), info: (...a: unknown[]) => info(...a), warning: (...a: unknown[]) => warning(...a) } }));

describe("AuthFlash", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    success.mockClear(); info.mockClear(); warning.mockClear();
    document.cookie = `${FLASH_COOKIE}=; path=/; max-age=0`;
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => { vi.useRealTimers(); });

  test("shows 'Signed in' with the person's first name, then the note is gone", async () => {
    setFlash("signed-in");
    render(<AuthFlash name="Daniel Ssebunya" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(success).toHaveBeenCalledWith("Signed in", { description: "Welcome back, Daniel." });
    expect(takeFlash()).toBeNull();
  });

  test("shows 'Signed out' as information, not as a success", async () => {
    setFlash("signed-out");
    render(<AuthFlash />);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(info).toHaveBeenCalledWith("Signed out", { description: "You've been signed out. See you soon." });
    expect(success).not.toHaveBeenCalled();
  });

  test("an expired session link (?reason=expired) says so, and the link is cleaned", async () => {
    window.history.replaceState(null, "", "/login?reason=expired&next=%2Floans");
    render(<AuthFlash />);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(warning).toHaveBeenCalledWith("Your session ended", { description: "For your security, please sign in again." });
    expect(window.location.search).toBe("?next=%2Floans");
  });

  test("an unknown code shows nothing, so a crafted cookie can't put words in a toast", async () => {
    document.cookie = `${FLASH_COOKIE}=${encodeURIComponent("Your account has been hacked, call 555")}; path=/`;
    render(<AuthFlash />);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(success).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  });

  test("with nothing left for it, it shows nothing", async () => {
    render(<AuthFlash name="Daniel" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(success).not.toHaveBeenCalled();
  });
});
