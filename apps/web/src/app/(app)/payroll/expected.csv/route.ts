// The expected-deductions file finance hands to payroll for a cycle.
// GET /payroll/expected.csv?cycle=2026-08
import { requireSession } from "@/lib/guard";
import { cycleReport, expectedCsv } from "@wola/db";
import { cycleBounds } from "@wola/engine";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cycle = new URL(req.url).searchParams.get("cycle") ?? new Date().toISOString().slice(0, 7);
  try { cycleBounds(cycle); } catch { return new Response("Bad cycle", { status: 400 }); }
  const csv = await requireSession(async (tx, ctx) => {
    if (!ctx.canSeeAllLoans) return null;
    return expectedCsv(await cycleReport(tx, ctx.tenantId, cycle));
  });
  if (csv === null) return new Response("Not allowed", { status: 403 });
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="expected-deductions-${cycle}.csv"`,
      "cache-control": "no-store",
    },
  });
}
