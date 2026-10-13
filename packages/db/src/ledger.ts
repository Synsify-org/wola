// packages/db/src/ledger.ts
// Pure helpers over a loan's schedule lines and ledger state. No database access:
// everything here takes plain numbers and dates, so the rules are unit-testable and
// shared by the repayment recorder, the "next deduction" shown to people, and the
// payroll cycle report — so they can never disagree about what is owed.
import { effectiveDueDate, type SuspensionWindow } from "@wola/engine";

export const EPS = 0.001;
export const round2 = (n: number) => Math.round(n * 100) / 100;

export interface RawLine {
  period_no: number | string;
  due_iso: string;
  opening_balance: number | string;
  principal_due: number | string;
  interest_due: number | string;
  instalment: number | string;
  closing_balance: number | string;
}

export interface LedgerLine {
  period_no: number;
  /** The date on the (unchanged) schedule. */
  due_iso: string;
  /** Where it actually falls once payment holidays are applied. */
  eff_due_iso: string;
  opening_balance: number;
  principal_due: number;
  interest_due: number;
  instalment: number;
  closing_balance: number;
}

/** Attach effective due dates (payment holidays applied) to schedule lines.
 *  The schedule rows themselves are never changed. */
export function withEffectiveDates(lines: RawLine[], windows: SuspensionWindow[]): LedgerLine[] {
  return lines
    .map((l) => ({
      period_no: Number(l.period_no),
      due_iso: l.due_iso.slice(0, 10),
      eff_due_iso: effectiveDueDate(l.due_iso.slice(0, 10), windows),
      opening_balance: Number(l.opening_balance),
      principal_due: Number(l.principal_due),
      interest_due: Number(l.interest_due),
      instalment: Number(l.instalment),
      closing_balance: Number(l.closing_balance),
    }))
    .sort((a, b) => a.period_no - b.period_no);
}

/** What must be paid, in total, for the loan to be UP TO DATE as of `cutoffIso`
 *  (inclusive): the interest scheduled through the last instalment due by then,
 *  minus interest already paid, plus any principal still standing above that
 *  instalment's scheduled closing balance.
 *
 *  `outstanding` and `interestPaid` are the ledger's position at the moment you
 *  want to measure from (e.g. the START of a payroll cycle, to get that cycle's
 *  expected deduction including any arrears brought forward). This is the same
 *  rule recordRepayment allocates by (interest first, then principal), so what is
 *  asked for is exactly what the ledger will accept. Returns 0 when nothing is due
 *  yet or the loan is paid up. */
export function amountDueThrough(
  lines: LedgerLine[], outstanding: number, interestPaid: number, cutoffIso: string,
): number {
  let cumInterest = 0;
  let last: LedgerLine | null = null;
  let cumAtLast = 0;
  for (const l of lines) {
    cumInterest += l.interest_due;
    if (l.eff_due_iso <= cutoffIso) { last = l; cumAtLast = cumInterest; }
  }
  if (!last) return 0;
  const interestOwed = Math.max(0, cumAtLast - interestPaid);
  const principalOwed = Math.max(0, outstanding - last.closing_balance);
  const due = round2(interestOwed + principalOwed);
  return due <= EPS ? 0 : due;
}
