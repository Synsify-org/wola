import Link from "next/link";
import { Users, AlertTriangle, ArrowRight, CheckCircle2, Clock, ShieldAlert } from "lucide-react";
import Metric from "./metric";
import DashboardCard from "./dashboard-card";
import DecisionQueue from "./decision-queue";
import PipelinePanel from "./pipeline-panel";
import CountUp from "./count-up";

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

// The HR hero: a data-quality panel, not a financial one. HR owns the inputs
// eligibility runs on, so "is my people-data healthy" is the one question —
// not "where is the money" (that's the CFO's hero, deliberately not this
// component's shape). The approval queue is demoted to a secondary panel
// here, unlike the dept-head dashboard where the queue IS the hero.
export default function DashboardHR({
  health,
  inbox,
  pipeline,
  currency,
}: {
  health: RegisterHealth;
  inbox: HRInboxItem[];
  pipeline: PipelineRow[];
  currency: string;
}) {
  const blockers = [
    health.missingDeptHead > 0
      ? { label: `${health.missingDeptHead} staff missing a department head`, }
      : null,
    health.missingSalary > 0
      ? { label: `${health.missingSalary} staff missing salary on file` }
      : null,
  ].filter((b): b is { label: string } => b !== null);

  const issues = health.missingDeptHead + health.missingSalary;

  return (
    <div className="space-y-4 xl:space-y-5">
      {/* HERO (row 1): employee register health as KPI cards. */}
      <section className="grid grid-cols-1 gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
        <Metric label="Headcount" value={<CountUp value={health.headcount} />} sub="Active employees" icon={Users} />
        <Metric label="On probation" value={<CountUp value={health.onProbation} />} sub="Not yet loan-eligible" icon={Clock} accent="awaiting" />
        <Metric
          label="Final warning"
          value={<CountUp value={health.onFinalWarning} />}
          sub="Blocked from new loans"
          icon={ShieldAlert}
          accent={health.onFinalWarning > 0 ? "rejected" : "approved"}
        />
        <Metric
          label="Data issues"
          value={<CountUp value={issues} />}
          sub={issues > 0 ? "Fix before they block applications" : "Register is complete"}
          icon={issues > 0 ? AlertTriangle : CheckCircle2}
          accent={issues > 0 ? "awaiting" : "approved"}
        />
      </section>

      {/* Row 2 (2/3 + 1/3): HR-stage queue beside register issues + pipeline. */}
      <section className="grid gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150 lg:grid-cols-3 xl:gap-5">
        <DecisionQueue title="At your stage" items={inbox} currency={currency} className="lg:col-span-2" />
        <div className="flex min-w-0 flex-col gap-4 xl:gap-5">
          <DashboardCard title="Register issues">
            {blockers.length > 0 ? (
              <ul className="space-y-2">
                {blockers.map((b) => (
                  <li key={b.label} className="flex items-center justify-between gap-3 rounded-xl bg-awaiting-wash px-3 py-2.5">
                    <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-awaiting" aria-hidden />
                      {b.label}
                    </span>
                    <Link
                      href="/settings/employees"
                      className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand hover:underline"
                    >
                      Fix <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-soft">
                No blocking data issues — every active employee has a department head and a salary on file.
              </p>
            )}
          </DashboardCard>
          <PipelinePanel data={pipeline} />
        </div>
      </section>
    </div>
  );
}
