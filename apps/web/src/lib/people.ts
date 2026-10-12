// Pure helpers for rendering a person as an avatar. No React, so they're unit-testable.

/** "Grace Namuli" -> "GN", "Staff" -> "S", "ceo@testco.io" -> "C", "" -> "?".
 *  First letter of the first and last word; never more than two characters. */
export function initialsOf(name: string | null | undefined): string {
  const clean = (name ?? "").trim();
  if (!clean) return "?";
  // An email address has no meaningful "last name": use the local part.
  const base = clean.includes("@") ? clean.split("@")[0].replace(/[._-]+/g, " ") : clean;
  const words = base.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/** Tint classes, drawn from theme tokens so a tenant's brand colour flows
 *  through. Deliberately no red/orange: those mean "rejected / needs attention"
 *  elsewhere in the UI and shouldn't colour a person. Written out in full so
 *  Tailwind's scanner sees every class. */
export const AVATAR_TINTS = [
  "bg-brand-100 text-brand-700",
  "bg-info-100 text-info-700",
  "bg-accent-50 text-accent-600",
  "bg-gray-100 text-gray-700",
] as const;

/** The same person always gets the same tint (a small stable string hash). */
export function tintIndexFor(name: string | null | undefined): number {
  const s = (name ?? "").trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % AVATAR_TINTS.length;
}
