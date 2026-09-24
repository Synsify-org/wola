import Link from "next/link";
import { ClipboardCheck, CheckCircle2, Circle, ArrowRight, Building2, GitBranch, Package, Users } from "lucide-react";
import Metric from "./metric";
import DashboardCard from "./dashboard-card";
import CountUp from "./count-up";

export type ConfigurationStatus = {
  productsCount: number;
  pipelinesCount: number;
  productsWithoutPipeline: { id: string; name: string }[];
  productsMissingRateIndex: { id: string; name: string }[];
  usersCount: number;
};

function ChecklistItem({
  done,
  label,
  action,
  href,
}: {
  done: boolean;
  label: string;
  action?: string;
  href?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="flex items-center gap-2.5 text-sm text-ink">
        {done ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-approved" />
        ) : (
          <Circle className="h-4 w-4 shrink-0 text-ink-faint" />
        )}
        {label}
      </span>
      {!done && action && href ? (
        <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand hover:underline">
          {action} <ArrowRight className="h-3 w-3" />
        </Link>
      ) : null}
    </div>
  );
}

// The Administration hero: "is this tenant configured correctly and
// running" — a readiness checklist, not a lending view. Deliberately no
// approval queue anywhere on this dashboard, even though org_admin can
// often also approve — configuring the rules and approving under them stay
// visually separate duties.
export default function DashboardAdmin({ status }: { status: ConfigurationStatus }) {
  const pipelinesReady = status.productsCount > 0 && status.productsWithoutPipeline.length === 0;
  const rateIndexReady = status.productsMissingRateIndex.length === 0;
  const checks = [status.productsCount > 0, pipelinesReady, rateIndexReady];
  const done = checks.filter(Boolean).length;
  const linkCard =
    "group flex items-center justify-between gap-3 rounded-2xl border border-rule bg-surface p-5 shadow-theme-xs transition-all duration-200 hover:border-brand-200 hover:shadow-theme-sm active:scale-[0.99]";

  return (
    <div className="space-y-4 xl:space-y-5">
      {/* Row 1: readiness at a glance. */}
      <section className="grid grid-cols-1 gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 sm:grid-cols-3 xl:gap-5">
        <Metric
          label="Setup progress"
          value={`${done} of ${checks.length}`}
          sub={done === checks.length ? "Ready to lend" : "Finish the checklist below"}
          icon={ClipboardCheck}
          accent={done === checks.length ? "approved" : "awaiting"}
        />
        <Metric label="Loan products" value={<CountUp value={status.productsCount} />} sub="Configured for this tenant" icon={Package} />
        <Metric label="Approval pipelines" value={<CountUp value={status.pipelinesCount} />} sub="Routing rules in force" icon={GitBranch} />
      </section>

      {/* Row 2 (2/3 + 1/3): the checklist beside the admin shortcuts. */}
      <section className="grid gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150 lg:grid-cols-3 xl:gap-5">
        <DashboardCard title="Configuration status" className="lg:col-span-2">
          <div className="-mt-3 divide-y divide-rule">
            <ChecklistItem
              done={status.productsCount > 0}
              label={`Loan products defined (${status.productsCount})`}
              action="Configure"
              href="/settings"
            />
            <ChecklistItem
              done={pipelinesReady}
              label={
                pipelinesReady
                  ? `Approval pipelines defined (${status.pipelinesCount})`
                  : `${status.productsWithoutPipeline.length} product${status.productsWithoutPipeline.length === 1 ? "" : "s"} missing an approval pipeline`
              }
              action="Configure"
              href="/settings"
            />
            <ChecklistItem
              done={rateIndexReady}
              label={
                rateIndexReady
                  ? "Rate index set for every interest-bearing product"
                  : `${status.productsMissingRateIndex.length} product${status.productsMissingRateIndex.length === 1 ? "" : "s"} missing a rate index`
              }
              action="Set"
              href="/settings"
            />
            {/* No disbursement-channel/bank concept exists in the schema yet —
                deliberately not shown as a fake checked/unchecked line. */}
          </div>
        </DashboardCard>

        <div className="grid content-start gap-4 xl:gap-5">
          <Link href="/settings/employees" className={linkCard}>
            <div className="flex items-center gap-3.5">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
                <Users className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <div>
                <div className="text-sm font-medium text-ink">Users & roles</div>
                <div className="num text-xl font-semibold text-ink"><CountUp value={status.usersCount} /></div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-ink-faint transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link href="/book" className={linkCard}>
            <div className="flex items-center gap-3.5">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
                <Building2 className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <div>
                <div className="text-sm font-medium text-ink">Loan book</div>
                <div className="text-[0.8125rem] text-ink-soft">Read-only view</div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-ink-faint transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>
    </div>
  );
}
