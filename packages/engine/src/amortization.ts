// packages/engine/src/amortization.ts
// Reducing-balance amortization engine. Pure computation — no DB, no I/O.
// Currency-agnostic: rounding precision is a parameter, so UGX (0 decimals),
// KES/USD (2 decimals), TZS/RWF (0) all use the SAME engine. Never edit this
// file to add a country — pass the currency's decimal places.
//
// Ported from MUA's "Amortization analysis final" workbook. With
// { decimals: null } it reproduces that sheet to full float precision
// (the parity test). With { decimals: 0 } it produces whole-shilling
// schedules that close at exactly zero via final-instalment remainder
// absorption (production behavior).

export type RoundingMode = number | null; // decimal places, or null = raw float

export interface ScheduleInput {
  principal: number;
  annualRate: number;        // e.g. 0.16 for 16%
  tenorMonths: number;
  paymentsPerYear?: number;  // default 12
  startDate: Date;
  decimals?: RoundingMode;   // null = exact match; 0 = whole units; 2 = cents
}

export interface ScheduleLine {
  period: number;
  dueDate: Date;
  openingBalance: number;
  interest: number;
  principal: number;
  instalment: number;
  closingBalance: number;
  cumulativeInterest: number;
}

export interface Schedule {
  instalment: number;         // the level scheduled payment
  lines: ScheduleLine[];
  totalInterest: number;
  engineVersion: string;
}

export const ENGINE_VERSION = "amort-1.0.0";

/** Round to `decimals` places, or pass through if null (exact-match mode). */
function round(value: number, decimals: RoundingMode): number {
  if (decimals === null) return value;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Standard annuity instalment: PMT = P·r / (1 − (1+r)^−n).
 *  Matches MUA sheet formula (M7). r is the per-period rate. */
export function computeInstalment(principal: number, periodRate: number, n: number): number {
  if (periodRate === 0) return principal / n;
  return (principal * periodRate) / (1 - Math.pow(1 + periodRate, -n));
}

/** Add `months` to a date, keeping the same day-of-month where possible,
 *  rolling forward to the next valid day when the target month is short
 *  (matches the sheet: 30 Jan + 1mo landed on 2 Mar, not 30 Feb). */
function addMonths(start: Date, months: number): Date {
  const d = new Date(start);
  const targetMonth = d.getMonth() + months;
  const result = new Date(d.getFullYear(), targetMonth, d.getDate());
  // If the day rolled over (e.g. Feb 30 -> Mar 2), JS already advanced it,
  // which is the behavior the sheet exhibits.
  return result;
}

/** Generate a full reducing-balance schedule. */
export function generateSchedule(input: ScheduleInput): Schedule {
  const {
    principal, annualRate, tenorMonths,
    paymentsPerYear = 12, startDate, decimals = 0,
  } = input;

  const periodRate = annualRate / paymentsPerYear;
  const rawInstalment = computeInstalment(principal, periodRate, tenorMonths);
  const instalment = round(rawInstalment, decimals);

  const lines: ScheduleLine[] = [];
  let balance = principal;
  let cumInterest = 0;

  for (let p = 1; p <= tenorMonths; p++) {
    const opening = balance;
    const interest = round(opening * periodRate, decimals);
    const isLast = p === tenorMonths;

    let principalDue: number;
    let payment: number;

    if (isLast) {
      // Final instalment absorbs the remainder so the loan closes at
      // EXACTLY zero — no rounding drift left outstanding.
      principalDue = opening;
      payment = round(opening + interest, decimals);
    } else {
      payment = instalment;
      principalDue = round(payment - interest, decimals);
    }

    let closing = round(opening - principalDue, decimals);
    // Floor at zero — never produce a negative balance (the defect in the
    // sheet's L-P cross-check column, deliberately not reproduced here).
    if (closing < 0) {
      principalDue = opening;
      closing = 0;
    }

    cumInterest = round(cumInterest + interest, decimals);

    lines.push({
      period: p,
      dueDate: addMonths(startDate, p),
      openingBalance: opening,
      interest,
      principal: principalDue,
      instalment: payment,
      closingBalance: closing,
      cumulativeInterest: cumInterest,
    });

    balance = closing;
    if (balance <= 0) break; // settled — freeze the schedule
  }

  return {
    instalment,
    lines,
    totalInterest: round(cumInterest, decimals),
    engineVersion: ENGINE_VERSION,
  };
}

/** Recompute the remaining schedule after an early/extra payment applied
 *  at the end of `afterPeriod`. Reduces the balance directly and floors at
 *  zero (matches the sheet's C-J logic on the 4,000,000 early payment). */
export function applyEarlyPayment(
  schedule: Schedule,
  input: ScheduleInput,
  afterPeriod: number,
  extraAmount: number,
): Schedule {
  const kept = schedule.lines.filter((l) => l.period <= afterPeriod);
  const last = kept[kept.length - 1];
  if (!last) return schedule;

  const { annualRate, paymentsPerYear = 12, startDate, decimals = 0, tenorMonths } = input;
  const periodRate = annualRate / paymentsPerYear;

  let balance = round(last.closingBalance - extraAmount, decimals);
  if (balance < 0) balance = 0;

  // reflect the extra payment on the line it was made
  last.closingBalance = balance;

  let cumInterest = last.cumulativeInterest;
  const newLines = [...kept];

  for (let p = afterPeriod + 1; p <= tenorMonths && balance > 0; p++) {
    const opening = balance;
    const interest = round(opening * periodRate, decimals);
    const isLast = p === tenorMonths;
    let principalDue: number;
    let payment: number;

    if (isLast) {
      principalDue = opening;
      payment = round(opening + interest, decimals);
    } else {
      payment = schedule.instalment;
      principalDue = round(payment - interest, decimals);
    }

    let closing = round(opening - principalDue, decimals);
    if (closing < 0) { principalDue = opening; closing = 0; }

    cumInterest = round(cumInterest + interest, decimals);
    newLines.push({
      period: p, dueDate: addMonths(startDate, p),
      openingBalance: opening, interest, principal: principalDue,
      instalment: payment, closingBalance: closing, cumulativeInterest: cumInterest,
    });
    balance = closing;
  }

  return { ...schedule, lines: newLines, totalInterest: cumInterest };
}