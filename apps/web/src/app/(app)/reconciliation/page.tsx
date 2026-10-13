// Payroll reconciliation: what should come out of salaries this month, what did, and
// the actions that close the gap. One cycle at a time ("YYYY-MM").
//
// Visible to whole-book roles (read); only FINANCE_ROLES get the money-moving
// buttons, and every action re-checks that on the server.
import { requireSession } from "@/lib/guard";
import { FINANCE_ROLES } from "@/lib/permissions";
import { cycleReport, listEarlyRepaymentRequests } from "@wola/db";
import { cycleBounds, shiftCycle } from "@wola/engine";
import { getTenantCurrency } from "@/lib/tenant";
import { pageMeta } from "@/lib/site";
import AccessDenied from "@/components/access-denied";
import ReconciliationView from "@/components/reconciliation-view";

export const metadata = pageMeta({ title: "Payroll reconciliation", description: "Expected against actual payroll deductions, and what to do about the gap.", path: "/reconciliation" });

const thisMonth = () => new Date().toISOString().slice(0, 7);
const validCycle = (c: string | undefined): c is string => { if (!c) return false; try { cycleBounds(c); return true; } catch { return false; } };

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<{ cycle?: string }> }) {
  const { cycle: asked } = await searchParams;
  const cycle = validCycle(asked) ? asked : thisMonth();
  const currency = await getTenantCurrency();

  const data = await requireSession(async (tx, ctx) => {
    if (!ctx.canSeeAllLoans) return null;
    const [report, requests] = await Promise.all([
      cycleReport(tx, ctx.tenantId, cycle),
      listEarlyRepaymentRequests(tx, ctx.tenantId, { status: "requested" }),
    ]);
    return { report, requests, canAct: FINANCE_ROLES.includes(ctx.role) };
  });

  if (!data) {
    return <AccessDenied title="Payroll reconciliation" message="Reconciliation is available to finance and management roles." />;
  }
  const current = thisMonth();
  return (
    <ReconciliationView
      report={data.report}
      requests={data.requests}
      canAct={data.canAct}
      currency={currency}
      prev={shiftCycle(cycle, -1)}
      next={cycle < current ? shiftCycle(cycle, 1) : null}
    />
  );
}
