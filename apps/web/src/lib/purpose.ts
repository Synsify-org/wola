// The purpose an applicant wrote, as shown on screen. Demo data marks its purposes with
// "[demo]" (scripts/seed-demo.mjs uses the marker to find its own rows on a re-run); the
// marker is never shown. Older demo rows read "[demo] asset for Grace Namuli", which is a
// label rather than a purpose, so those show no purpose at all.
const SEED_MARK = /^\[demo\]\s*/i;

export function displayPurpose(purpose: string | null | undefined): string | null {
  if (!purpose) return null;
  let p = purpose.trim();
  if (SEED_MARK.test(p)) {
    p = p.replace(SEED_MARK, "").trim();
    if (/^(advance|term|asset) for .+$/i.test(p)) return null;
  }
  return p || null;
}
