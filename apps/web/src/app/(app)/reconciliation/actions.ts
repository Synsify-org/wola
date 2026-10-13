"use server";
// Payroll reconciliation actions. Money-moving, so finance roles only
// (FINANCE_ROLES, the same set that may record a repayment on a loan page), checked
// here on every call: the buttons being hidden is a convenience, this is the gate.
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/guard";
import { FINANCE_ROLES } from "@/lib/permissions";
import {
  audit, cycleReport, postBulkRun, postActuals, previewActuals, recordRepayment,
  suspendLoan, cancelSuspension, recordEarlyRepayment, declineEarlyRepayment,
  type ActualsPreview, type RunResult,
} from "@wola/db";
import { cycleBounds } from "@wola/engine";

const DENIED = "You don't have permission to record payroll deductions.";
type Fail = { ok: false; error: string };

const refresh = () => {
  revalidatePath("/reconciliation");
  revalidatePath("/");
  revalidatePath("/loans");
  revalidatePath("/book");
};
const validCycle = (c: string) => { try { cycleBounds(c); return true; } catch { return false; } };

/** Record every due deduction for the cycle, in one transaction. */
export async function postBulkRunAction(cycle: string): Promise<({ ok: true } & RunResult) | Fail> {
  if (!validCycle(cycle)) return { ok: false, error: "Pick a payroll month." };
  return requireSession(async (tx, ctx) => {
    if (!FINANCE_ROLES.includes(ctx.role)) return { ok: false, error: DENIED };
    try {
      const run = await postBulkRun(tx, { tenantId: ctx.tenantId, cycle, actorId: ctx.userId });
      if (run.runId) {
        await audit(tx, {
          tenantId: ctx.tenantId, actorId: ctx.userId, action: "payroll.bulk_run", entity: "payroll_run", entityId: run.runId,
          after: { cycle, loans: run.posted, total: run.postedTotal },
        });
      }
      refresh();
      return { ok: true, ...run };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Couldn't record the deductions." };
    }
  });
}

/** Match payroll's file against what was expected. Changes nothing. */
export async function previewActualsAction(cycle: string, csv: string): Promise<({ ok: true } & { preview: ActualsPreview }) | Fail> {
  if (!validCycle(cycle)) return { ok: false, error: "Pick a payroll month." };
  if (csv.length > 2_000_000) return { ok: false, error: "That file is too large (2 MB limit)." };
  return requireSession(async (tx, ctx) => {
    if (!FINANCE_ROLES.includes(ctx.role)) return { ok: false, error: DENIED };
    return { ok: true, preview: await previewActuals(tx, ctx.tenantId, cycle, csv) };
  });
}

/** Record what payroll's file says was deducted. The file is checked again here. */
export async function postActualsAction(cycle: string, csv: string, fileName: string | null): Promise<({ ok: true } & RunResult) | Fail> {
  if (!validCycle(cycle)) return { ok: false, error: "Pick a payroll month." };
  if (csv.length > 2_000_000) return { ok: false, error: "That file is too large (2 MB limit)." };
  return requireSession(async (tx, ctx) => {
    if (!FINANCE_ROLES.includes(ctx.role)) return { ok: false, error: DENIED };
    try {
      const run = await postActuals(tx, { tenantId: ctx.tenantId, cycle, csv, actorId: ctx.userId, fileName: fileName?.slice(0, 120) ?? null });
      if (run.runId) {
        await audit(tx, {
          tenantId: ctx.tenantId, actorId: ctx.userId, action: "payroll.import", entity: "payroll_run", entityId: run.runId,
          after: { cycle, file: fileName, loans: run.posted, total: run.postedTotal, skipped: run.skipped.length },
        });
      }
      refresh();
      return { ok: true, ...run };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Couldn't record the file." };
    }
  });
}

/** Catch up: record money received against one loan (e.g. a missed deduction paid
 *  in cash). Dated today: the missed cycle stays as it happened. */
export async function catchUpAction(loanId: string, amount: number): Promise<{ ok: true; outstanding: number; settled: boolean } | Fail> {
  if (!(amount > 0)) return { ok: false, error: "Enter an amount greater than zero." };
  return requireSession(async (tx, ctx) => {
    if (!FINANCE_ROLES.includes(ctx.role)) return { ok: false, error: DENIED };
    try {
      const r = await recordRepayment(tx, { tenantId: ctx.tenantId, loanId, amount, source: "manual", postedBy: ctx.userId });
      await audit(tx, {
        tenantId: ctx.tenantId, actorId: ctx.userId, action: "loan.repayment_recorded", entity: "loan", entityId: loanId,
        after: { amount, source: "manual", via: "reconciliation", settled: r.settled },
      });
      refresh();
      return { ok: true, outstanding: r.outstanding, settled: r.settled };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Couldn't record that payment." };
    }
  });
}

/** Pause a loan's instalments for whole months (an event; the schedule isn't rewritten). */
export async function pauseLoanAction(loanId: string, fromMonth: string, months: number, reason: string): Promise<{ ok: true; from: string; to: string } | Fail> {
  return requireSession(async (tx, ctx) => {
    if (!FINANCE_ROLES.includes(ctx.role)) return { ok: false, error: "You don't have permission to pause payments." };
    const r = await suspendLoan(tx, { tenantId: ctx.tenantId, loanId, fromMonth, months, reason, actorId: ctx.userId });
    if (!r.ok) return r;
    await audit(tx, {
      tenantId: ctx.tenantId, actorId: ctx.userId, action: "loan.paused", entity: "loan", entityId: loanId,
      after: { from: r.from, to: r.to, months: r.months, reason: reason.trim() },
    });
    refresh();
    return { ok: true, from: r.from, to: r.to };
  });
}

export async function cancelPauseAction(suspensionId: string): Promise<{ ok: true } | Fail> {
  return requireSession(async (tx, ctx) => {
    if (!FINANCE_ROLES.includes(ctx.role)) return { ok: false, error: "You don't have permission to change a pause." };
    const r = await cancelSuspension(tx, { tenantId: ctx.tenantId, suspensionId, actorId: ctx.userId });
    if (!r.ok) return r;
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, action: "loan.pause_cancelled", entity: "loan", entityId: r.loanId, after: { suspensionId } });
    refresh();
    return { ok: true };
  });
}

/** Finance: the money for an early-repayment request has arrived. */
export async function recordEarlyAction(requestId: string): Promise<{ ok: true; amount: number; settled: boolean; reamortized: boolean } | Fail> {
  return requireSession(async (tx, ctx) => {
    if (!FINANCE_ROLES.includes(ctx.role)) return { ok: false, error: DENIED };
    const r = await recordEarlyRepayment(tx, { tenantId: ctx.tenantId, requestId, actorId: ctx.userId });
    if (!r.ok) return r;
    await audit(tx, {
      tenantId: ctx.tenantId, actorId: ctx.userId, action: "repayment.early_recorded", entity: "early_repayment_request", entityId: requestId,
      after: { amount: r.amount, settled: r.settled, reamortized: r.reamortized },
    });
    refresh();
    return { ok: true, amount: r.amount, settled: r.settled, reamortized: r.reamortized };
  });
}

export async function declineEarlyAction(requestId: string, note: string): Promise<{ ok: true } | Fail> {
  return requireSession(async (tx, ctx) => {
    if (!FINANCE_ROLES.includes(ctx.role)) return { ok: false, error: DENIED };
    const r = await declineEarlyRepayment(tx, { tenantId: ctx.tenantId, requestId, actorId: ctx.userId, note });
    if (!r.ok) return r;
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, action: "repayment.early_declined", entity: "early_repayment_request", entityId: requestId, after: { note: note.trim() } });
    refresh();
    return { ok: true };
  });
}

/** For the page: the report for a cycle (read-only; any full-book role). */
export async function loadCycle(cycle: string) {
  return requireSession(async (tx, ctx) => cycleReport(tx, ctx.tenantId, cycle));
}
