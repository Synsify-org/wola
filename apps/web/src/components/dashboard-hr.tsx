import Link from "next/link";
import { Users, AlertTriangle, ArrowRight } from "lucide-react";
import PipelinePanel from "./pipeline-panel";

export type RegisterHealth = {
  headcount: number;
  onProbation: number;
  onFinalWarning: number;
  missingDeptHead: number;
  missingSalary: number;
};
export type HRInboxItem = {
  applicationId: string;
  employeeName: string;
  productName: string;
  amount: number;
  stageRole: string;
};
type PipelineRow = { status: string; n: number };

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();

// The HR hero: a data-quality panel, not a financial one. HR owns the inputs
// eligibility runs on, so "is my people-data healthy" is the one question —
// not "where is the money" (that's the CFO's hero, deliberately not this
// component's shape). The approval queue is demoted to a secondary panel
// here, unlike the dept-head dashboard where the queue IS the hero.
export default function DashboardHR({
  health,
  inbox,
  pipeline,
}: {
  health: RegisterHealth;
  inbox: HRInboxItem[];
  pipeline: PipelineRow[];
}) {
  const blockers = [
    health.missingDeptHead > 0
      ? { label: `${health.missingDeptHead} staff missing a department head`, }
      : null,
    health.missingSalary > 0
      ? { label: `${health.missingSalary} staff missing salary on file` }
      : null,
  ].filter((b): b is { label: string } => b !== null);

  return (
    <div className="space-y-6">
      {/* HERO: employee register health */}
      <div className="rounded-xl border border-rule bg-surface p-5 shadow-theme-md">
        <div className="mb-4 flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-brand-700">
            <Users className="h-4 w-4" />
          </span>
          <h2 className="text-sm font-semibold text-ink">Employee register health</h2>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="num text-2xl font-bold text-ink">{health.headcount}</div>
            <div className="caps mt-1">Headcount</div>
          </div>
          <div>
            <div className="num text-2xl font-bold text-ink">{health.onProbation}</div>
            <div className="caps mt-1">On probation</div>
          </div>
          <div>
            <div className="num text-2xl font-bold text-ink">{health.onFinalWarning}</div>
            <div className="caps mt-1">Final warning</div>
          </div>
        </div>

        {blockers.length > 0 ? (
          <div className="mt-4 space-y-2 border-t border-rule pt-4">
            {blockers.map((b) => (
              <div
                key={b.label}
                className="flex items-center justify-between gap-3 rounded-lg bg-awaiting-wash px-3 py-2"
              >
                <span className="flex items-center gap-2 text-sm text-ink">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-awaiting" />
                  {b.label}
                </span>
                <Link
                  href="/settings/employees"
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand hover:underline"
                >
                  Fix <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 border-t border-rule pt-4 text-sm text-ink-soft">
            No blocking data issues — every active employee has a department head and a salary on file.
          </p>
        )}
      </div>

      {/* Secondary: HR-stage approval queue + applications overview */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">At your stage</h2>
            {inbox.length > 0 ? (
              <Link href="/approvals" className="text-xs font-medium text-brand hover:underline">
                View all
              </Link>
            ) : null}
          </div>
          {inbox.length === 0 ? (
            <div className="rounded-xl border border-rule bg-surface p-6 text-center shadow-theme-sm">
              <p className="text-sm text-ink-soft">Nothing is waiting on you.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-rule bg-surface shadow-theme-sm">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Applicant</th>
                    <th>Product</th>
                    <th className="r">Amount</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {inbox.map((item) => (
                    <tr key={item.applicationId}>
                      <td className="font-medium text-ink">{item.employeeName}</td>
                      <td className="text-ink-soft">{item.productName}</td>
                      <td className="r num">{ugx(item.amount)}</td>
                      <td className="r">
                        <Link
                          href={"/approvals?app=" + item.applicationId}
                          className="text-xs font-medium text-brand hover:underline"
                        >
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <PipelinePanel data={pipeline} />
      </section>

      <section className="border-t border-rule pt-6">
        <Link href="/settings/employees" className="text-sm text-ink-soft hover:text-ink">
          Open the employee directory &rarr;
        </Link>
      </section>
    </div>
  );
}
