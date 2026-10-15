import type { ReactNode } from "react";
import { Wallet, TrendingUp, Banknote, Users } from "lucide-react";
import { formatMoney } from "@wola/engine";
import type { PeopleOverview, ReconciliationCycle, StageWaiting } from "@wola/db";
import DashboardCard from "./dashboard-card";
import DecisionQueue from "./decision-queue";
import Reveal from "./reveal";
import TrendLineChart from "./trend-line-chart";
import type { CollectionsPoint } from "./dashboard-cfo";
import Metric from "./metric";
import CountUp from "./count-up";
import { humanize } from "@/lib/product-summary";

export type CEOInboxItem = {
  applicationId: string;
  employeeName: string;
  productName: string;
  amount: number;
  stageRole: string;
};
export type MixRow = { name: string; kind: string; n: number; principal: number };

type Tone = "plain" | "good" | "warn" | "bad";
const TONE: Record<Tone, string> = {
  plain: "text-ink",
  good: "text-approved",
  warn: "text-awaiting",
  bad: "text-rejected",
};

/** One line of the Money / People summaries: what, how much, and a short why. */
function Row({ label, value, note, tone = "plain", children }: {
  label: string; value: ReactNode; note?: string; tone?: Tone; children?: ReactNode;
}) {
  return (
    <li className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-ink-soft">{label}</span>
        <span className={"num text-right text-base font-semibold " + TONE[tone]}>{value}</span>
      </div>
      {note ? <p className="mt-0.5 text-xs text-ink-faint">{note}</p> : null}
      {children}
    </li>
  );
}

const waited = (hours: number) => {
  const h = Math.floor(hours), d = Math.floor(hours / 24);
  return hours < 1 ? "under an hour" : hours < 48 ? `${h} hour${h === 1 ? "" : "s"}` : `${d} days`;
};

// The CEO's overview: the CFO's money picture and HR's people picture, summarised on
// one screen and read-only. Oversight, not operations: no disbursing, reconciling or
// register edits here, and no worklist beyond the CEO's own sign-offs. Each figure is
// one the CFO or HR dashboard already shows in full, so the numbers always agree.
export default function DashboardCEO({
  totalExposure,
  activeLoans,
  interestCollected,
  interestProjected,
  inProgress,
  settled,
  cycle,
  payouts,
  arrears,
  register,
  people,
  stages,
  inbox,
  collections,
  currency,
}: {
  totalExposure: number;
  activeLoans: number;
  /** Interest received through repayments to date: "Interest earned". */
  interestCollected: number;
  /** Interest the book earns if every active loan runs to term. */
  interestProjected: number;
  inProgress: number;
  settled: number;
  /** This month's payroll: deductions expected vs received, and the exceptions. */
  cycle: ReconciliationCycle;
  /** Approved loans not yet paid out. */
  payouts: { count: number; amount: number };
  /** Instalments due to date and not paid, across the book. */
  arrears: { amount: number; loans: number };
  register: { onProbation: number; onFinalWarning: number; issues: number };
  people: PeopleOverview;
  stages: StageWaiting[];
  inbox: CEOInboxItem[];
  collections: CollectionsPoint[];
  currency: string;
}) {
  const money = (n: number) => formatMoney(n, currency);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const collectedPct = cycle.expected > 0 ? Math.round((cycle.actual / cycle.expected) * 100) : null;
  const uptake = people.headcount > 0 ? Math.round((people.borrowers / people.headcount) * 100) : 0;
  const atRiskPct = totalExposure > 0 ? Math.round((arrears.amount / totalExposure) * 1000) / 10 : 0;
  const exceptions = cycle.exceptions.length;
  // The month is still open: what isn't in yet and isn't an exception is simply still to come.
  const toCome = Math.max(0, cycle.expected - cycle.actual - cycle.exceptions.reduce((t, e) => t + e.shortfall, 0));
  const departments = people.byDepartment.filter((d) => d.headcount > 0).slice(0, 6);

  return (
    <div className="space-y-4 xl:space-y-5">
      {/* Row 1: the four figures that answer "is the programme healthy?" */}
      <section className="grid grid-cols-1 gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
        <Metric
          tone="brand"
          label="Lent out, still owed"
          value={<CountUp value={totalExposure} format="money" currency={currency} />}
          sub={plural(activeLoans, "active loan", "active loans")}
          icon={Wallet}
        />
        <Metric
          label="Collected this month"
          value={<CountUp value={cycle.actual} format="money" currency={currency} />}
          sub={collectedPct === null
            ? `Nothing due yet in ${cycle.cycleLabel}`
            : cycle.actual === 0 && exceptions === 0
              ? `Payroll not recorded yet · ${money(cycle.expected)} due in ${cycle.cycleLabel}`
              : `${collectedPct}% of ${money(cycle.expected)} due in ${cycle.cycleLabel}`}
          icon={Banknote}
          tone={exceptions > 0 ? "warn" : "teal"}
        />
        <Metric
          label="Interest earned"
          value={<CountUp value={interestCollected} format="money" currency={currency} />}
          sub={`Collected to date · ${money(interestProjected)} more if every loan runs to term`}
          icon={TrendingUp}
          tone="deep"
        />
        <Metric
          label="Staff borrowing"
          value={`${people.borrowers} of ${people.headcount}`}
          sub={`${uptake}% of active staff have a running loan`}
          icon={Users}
          tone="info"
        />
      </section>

      {/* Row 2: the CFO's side and HR's side, one summary each. */}
      <Reveal as="section" className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:gap-5">
        <DashboardCard title="Money">
          <ul className="divide-y divide-rule">
            <Row
              label="Money at risk"
              value={money(arrears.amount)}
              tone={arrears.loans > 0 ? "bad" : "good"}
              note={arrears.loans > 0
                ? `${plural(arrears.loans, "loan is", "loans are")} behind on deductions · ${atRiskPct}% of what is owed`
                : "No loan is behind on its deductions"}
            />
            <Row
              label={`Payroll, ${cycle.cycleLabel}`}
              value={`${money(cycle.actual)} of ${money(cycle.expected)}`}
              tone={exceptions > 0 ? "warn" : "plain"}
              note={exceptions > 0
                ? `${plural(exceptions, "deduction", "deductions")} missed or short so far`
                : toCome > 0.5
                  ? `${money(toCome)} still to come this month; nothing missed so far`
                  : "Every deduction due this month has been received"}
            />
            <Row
              label="Waiting to be paid out"
              value={money(payouts.amount)}
              note={payouts.count > 0
                ? `${plural(payouts.count, "approved loan", "approved loans")} for finance to disburse`
                : "Every approved loan has been paid out"}
            />
            <Row label="Loans fully repaid" value={<CountUp value={settled} />} note="Closed with nothing left to pay" />
          </ul>
        </DashboardCard>

        <DashboardCard title="People">
          <ul className="divide-y divide-rule">
            <Row
              label="Applications in review"
              value={<CountUp value={inProgress} />}
              note={stages.length > 0 ? "Where they are waiting" : "Nothing is waiting for a decision"}
            >
              {stages.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {stages.map((s) => (
                    <li key={s.stageRole} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-lg bg-paper px-3 py-2 text-xs">
                      <span className="text-ink">
                        {humanize(s.stageRole)} <span className="text-ink-faint">· {plural(s.count, "application", "applications")}</span>
                      </span>
                      <span className={s.overdue > 0 ? "font-medium text-rejected" : "text-ink-soft"}>
                        {s.overdue > 0 ? `${s.overdue} past the time limit · ` : ""}longest {waited(s.oldestHours)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Row>
            <Row
              label="Left with a balance"
              value={money(people.leaversWithBalance.outstanding)}
              tone={people.leaversWithBalance.people > 0 ? "bad" : "good"}
              note={people.leaversWithBalance.people > 0
                ? `${plural(people.leaversWithBalance.people, "person has", "people have")} left with a loan still running`
                : "Nobody has left with a loan still running"}
            />
            <Row
              label="Not eligible for new loans"
              value={<CountUp value={register.onProbation + register.onFinalWarning} />}
              note={`${register.onProbation} on probation · ${register.onFinalWarning} on final warning`}
            />
            <Row
              label="Staff records to fix"
              value={<CountUp value={register.issues} />}
              tone={register.issues > 0 ? "warn" : "good"}
              note={register.issues > 0 ? "Missing details HR needs to complete" : "Every record is complete"}
            />
          </ul>
        </DashboardCard>
      </Reveal>

      {/* Row 3: collections over time beside uptake by department. */}
      <Reveal as="section" className="grid grid-cols-1 gap-4 lg:grid-cols-3 xl:gap-5">
        <TrendLineChart
          title="Collections"
          subtitle={`Money received against instalments due, last 6 months · ${currency}`}
          data={collections}
          actual={{ key: "collected", label: "Collected", color: "var(--color-brand)" }}
          target={{ key: "expected", label: "Expected", color: "var(--color-chart-target)" }}
          currency={currency}
          markerX={collections.find((c) => c.current)?.label}
          compareNote="vs expected"
          emptyText="No instalments fell due in the last six months, so there's nothing to compare yet."
          csvName="collections"
          reportHref="/reports"
          className="lg:col-span-2"
        />
        <DashboardCard title="Uptake by department">
          {departments.length === 0 ? (
            <p className="text-sm text-ink-soft">No active staff on file yet.</p>
          ) : (
            <ul className="space-y-3.5">
              {departments.map((d) => {
                const pct = Math.round((d.borrowers / d.headcount) * 100);
                return (
                  <li key={d.department}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-ink" title={d.department}>{d.department}</span>
                      <span className="num shrink-0 text-xs text-ink-soft">{d.borrowers} of {d.headcount}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                    </div>
                    {d.outstanding > 0 ? <p className="num mt-1 text-xs text-ink-faint">{money(d.outstanding)} owed</p> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </DashboardCard>
      </Reveal>

      {/* Row 4: the CEO-stage queue, quiet, not the hero. */}
      <DecisionQueue
        title="Awaiting your sign-off"
        items={inbox}
        currency={currency}
        emptyText="Nothing awaiting your sign-off."
        className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200"
      />
    </div>
  );
}
