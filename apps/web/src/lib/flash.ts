// One-shot messages that must survive a page change: "Signed in", "You've been signed
// out", "Your session ended". The sender leaves a short-lived cookie holding a CODE; the
// next page shows the toast for that code and deletes the cookie.
//
// Codes map to fixed wording HERE. The cookie (and the ?reason= link) never carry message
// text, so nobody can craft a link that makes Wola say arbitrary words in a toast that
// looks trustworthy.
//
// Isomorphic on purpose: route handlers set the cookie header themselves with the same
// name and lifetime (FLASH_COOKIE, FLASH_MAX_AGE); the browser helpers are guarded.

export const FLASH_COOKIE = "wola_flash";
export const FLASH_MAX_AGE = 60; // seconds: long enough to cross one redirect, short enough to never replay

export type FlashKind = "success" | "info" | "warning";
export type Flash = { kind: FlashKind; title: string; description?: string };

const firstName = (name?: string | null) => (name ?? "").trim().split(/\s+/)[0] || null;

/** The wording for a code, or null for anything not in the vocabulary. */
export function describeFlash(code: string | null | undefined, name?: string | null): Flash | null {
  switch (code) {
    case "signed-in": {
      const n = firstName(name);
      return { kind: "success", title: "Signed in", description: n ? `Welcome back, ${n}.` : "Welcome back." };
    }
    case "signed-out":
      return { kind: "info", title: "Signed out", description: "You've been signed out. See you soon." };
    case "session-expired":
      return { kind: "warning", title: "Your session ended", description: "For your security, please sign in again." };
    case "password-reset":
      return { kind: "success", title: "Password updated", description: "Sign in with your new password." };
    default:
      return null;
  }
}

/** Leave a flash for the next page (browser only). */
export function setFlash(code: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${FLASH_COOKIE}=${encodeURIComponent(code)}; path=/; max-age=${FLASH_MAX_AGE}; samesite=lax`;
}

/** Take the flash left for this page (browser only): returns its code and removes it. */
export function takeFlash(): string | null {
  if (typeof document === "undefined") return null;
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${FLASH_COOKIE}=`));
  if (!hit) return null;
  document.cookie = `${FLASH_COOKIE}=; path=/; max-age=0; samesite=lax`;
  return decodeURIComponent(hit.slice(FLASH_COOKIE.length + 1));
}

/** ?reason=expired on the login link maps to the same vocabulary. */
export function reasonToFlashCode(reason: string | null | undefined): string | null {
  return reason === "expired" ? "session-expired" : reason === "reset" ? "password-reset" : null;
}
