import Link from "next/link";
import { ClipboardCheck, CheckCircle2, Circle, ArrowRight } from "lucide-react";

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

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-rule bg-surface p-5 shadow-theme-md">
        <div className="mb-1 flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-brand-700">
            <ClipboardCheck className="h-4 w-4" />
          </span>
          <h2 className="text-sm font-semibold text-ink">Configuration status</h2>
        </div>
        <div className="divide-y divide-rule">
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
      </div>

      <section className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/settings/employees"
          className="flex items-center justify-between rounded-xl border border-rule bg-surface p-4 shadow-theme-sm transition-colors hover:border-brand-200 hover:bg-brand-wash"
        >
          <div>
            <div className="caps mb-1">Users & roles</div>
            <div className="num text-lg font-semibold text-ink">{status.usersCount}</div>
          </div>
          <ArrowRight className="h-4 w-4 text-ink-faint" />
        </Link>
        <Link
          href="/book"
          className="flex items-center justify-between rounded-xl border border-rule bg-surface p-4 shadow-theme-sm transition-colors hover:border-brand-200 hover:bg-brand-wash"
        >
          <div>
            <div className="caps mb-1">Loan book</div>
            <div className="text-sm text-ink-soft">Read-only view</div>
          </div>
          <ArrowRight className="h-4 w-4 text-ink-faint" />
        </Link>
      </section>
    </div>
  );
}
