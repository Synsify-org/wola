// packages/engine/src/suspension.ts
// Payment holidays ("suspensions") as an EVENT over an unchanged schedule.
//
// A suspension says: no instalments are due between `from` and `to`. We do NOT
// rewrite or replace schedule rows (the schedule is a pure projection and its
// versions are an audit trail). Instead each line gets an EFFECTIVE due date:
// every line from the holiday onward moves later by the number of calendar
// months the holiday covers, so the loan simply finishes that many months later.
// The instalments are the same amounts; interest does not accrue extra during the
// holiday (a policy choice, recorded in docs/business/POLICY_DECISIONS.md).
//
// Dates are ISO "YYYY-MM-DD" strings, handled in UTC with no time-of-day, so
// time zones can't shift a due date by a day.

export interface SuspensionWindow {
  /** First day with no instalment due (inclusive). */
  from: string;
  /** Last day with no instalment due (inclusive). */
  to: string;
}

const parse = (iso: string): { y: number; m: number; d: number } => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date "${iso}".`);
  return { y, m, d };
};
const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Whole calendar months a window touches: Nov 1-Nov 30 = 1; Nov 15-Dec 14 = 2. */
export function monthsSpanned(w: SuspensionWindow): number {
  const a = parse(w.from), b = parse(w.to);
  const n = (b.y * 12 + b.m) - (a.y * 12 + a.m) + 1;
  if (n < 1) throw new Error("A suspension can't end before it starts.");
  return n;
}

/** Add whole months, keeping the day of month (clamped to the month's last day:
 *  31 Jan + 1 month = 28/29 Feb). */
export function addMonthsIso(iso: string, months: number): string {
  const { y, m, d } = parse(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, lastDay(ny, nm)))}`;
}

/** Where a scheduled due date actually lands once the holidays are applied.
 *  Windows are processed in order of start date, each against the date as already
 *  moved by earlier ones. */
export function effectiveDueDate(originalIso: string, windows: SuspensionWindow[]): string {
  let date = originalIso.slice(0, 10);
  for (const w of [...windows].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))) {
    if (date >= w.from.slice(0, 10)) date = addMonthsIso(date, monthsSpanned(w));
  }
  return date;
}

/** True when the two windows share any day. */
export function windowsOverlap(a: SuspensionWindow, b: SuspensionWindow): boolean {
  return a.from <= b.to && b.from <= a.to;
}

/** The first and last day of a payroll cycle "YYYY-MM". */
export function cycleBounds(cycle: string): { start: string; end: string; label: string } {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(cycle);
  if (!m) throw new Error(`Invalid payroll cycle "${cycle}" (expected YYYY-MM).`);
  const y = Number(m[1]), mo = Number(m[2]);
  const label = new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return { start: `${y}-${pad(mo)}-01`, end: `${y}-${pad(mo)}-${pad(lastDay(y, mo))}`, label };
}

/** The cycle before / after a given one. */
export const shiftCycle = (cycle: string, by: number): string => addMonthsIso(`${cycle}-01`, by).slice(0, 7);

/** The day before an ISO date. */
export function dayBefore(iso: string): string {
  const { y, m, d } = parse(iso);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}
