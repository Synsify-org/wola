"use server";
// Practice data for a TRIAL organisation, started by a platform operator. The library refuses anything that is
// not flagged as a trial (and anything that already has loans), so this is safe even if called with the wrong id.
// Every use is recorded in the operators' audit trail, and in the organisation's own audit log.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireSuperSession } from "@/lib/super-admin-guard";
import { db } from "@/lib/tenant";
import { clientIp } from "@/lib/client-ip";
import { loadPracticeBook, loadPayrollHistory, recordPlatformEvent } from "@wola/db";

export type PracticeResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function loadPracticeDataAction(tenantId: string, mode: "book" | "history", typedSlug: string): Promise<PracticeResult> {
  if (!UUID.test(tenantId)) return { ok: false, error: "Unknown organisation." };
  const ip = clientIp(await headers());
  return requireSuperSession(async (ctx) => {
    const [t] = await db`SELECT slug FROM tenants WHERE id = ${tenantId}`;
    if (!t) return { ok: false, error: "Unknown organisation." };
    if (typedSlug.trim() !== t.slug) return { ok: false, error: `Type the organisation's short name (${t.slug}) exactly to confirm.` };
    try {
      if (mode === "history") {
        const r = await loadPayrollHistory(db, tenantId, { actorId: ctx.userId });
        await recordPlatformEvent(db, { actorId: ctx.userId, action: "platform.practice_payroll_history", tenantId, detail: r, ip });
        revalidatePath(`/admin/tenants/${tenantId}`);
        return { ok: true, text: `Recorded ${plural(r.deductions, "deduction", "deductions")} over ${plural(r.months, "month", "months")}. Last month was left with a missed and a short deduction.` };
      }
      const s = await loadPracticeBook(db, tenantId, { actorId: ctx.userId });
      await recordPlatformEvent(db, { actorId: ctx.userId, action: "platform.practice_data_loaded", tenantId, detail: { ...s }, ip });
      revalidatePath(`/admin/tenants/${tenantId}`);
      return {
        ok: true,
        text: `Created ${plural(s.historyLoans, "loan", "loans")} with ${plural(s.payrollMonths, "month", "months")} of payroll history, ${s.awaitingDisbursement} waiting for disbursement, ${plural(s.inFlight, "application", "applications")} at different approval stages and ${s.rejected} rejected.`,
      };
    } catch (e) {
      // The library's messages are written for people ("only a trial...", "already has loans...").
      return { ok: false, error: e instanceof Error ? e.message : "Could not load practice data." };
    }
  });
}
