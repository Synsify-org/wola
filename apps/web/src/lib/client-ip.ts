// apps/web/src/lib/client-ip.ts — the requesting client's IP, for login rate
// limiting. One implementation for every sign-in surface.
//
// Order matters for trust. On Vercel, x-vercel-forwarded-for and x-real-ip
// are set by Vercel's edge from the real connection, and Vercel overwrites
// any client-supplied X-Forwarded-For — so all three are trustworthy there,
// and the Vercel-specific one is preferred. Behind any OTHER proxy (on-prem),
// only the header that proxy itself sets can be trusted; an attacker talking
// to the app directly could otherwise rotate a fake X-Forwarded-For per
// request to dodge the per-IP limit. On-prem installs must terminate traffic
// at a proxy that sets X-Real-IP (nginx: proxy_set_header X-Real-IP
// $remote_addr) and not expose the app port directly.
import "server-only";

export function clientIp(h: Headers): string {
  return (
    h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    // No proxy at all (local dev): one shared key, rather than leaving rate
    // limiting keyed on `undefined`.
    "unknown"
  );
}
