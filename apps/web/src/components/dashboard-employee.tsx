import Link from "next/link";
import Metric from "./metric";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();
const shortDate = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

type Mine = {
  activeLoans: number;
  outstanding: number;
  monthlyDeduction: number;
  nextDueDate: string | null;
  applicationsInFlight: number;
};

export default function DashboardEmployee({ mine }: { mine: Mine }) {
  const empty = mine.activeLoans === 0 && mine.applicationsInFlight === 0;

  if (empty) {
    return (
      <div className="rounded-lg border border-rule bg-surface p-8 text-center">
        <p className="text-sm text-ink-soft">
          You have no loans or applications yet.
        </p>
        <Link
          href="/apply"
          className="btn btn--primary mt-5 inline-block rounded-full"
        >
          Apply for a loan
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Active loans" value={String(mine.activeLoans)} />
        <Metric label="Outstanding" value={ugx(mine.outstanding)} sub="Scheduled" />
        <Metric
          label="Monthly deduction"
          value={ugx(mine.monthlyDeduction)}
          sub="From payroll"
        />
        <Metric
          label="Next due"
          value={mine.nextDueDate ? shortDate(mine.nextDueDate) : "None"}
        />
      </section>

      {mine.applicationsInFlight > 0 ? (
        <p className="text-sm text-awaiting">
          {mine.applicationsInFlight} application
          {mine.applicationsInFlight === 1 ? "" : "s"} in review.
        </p>
      ) : null}

      <div className="flex gap-3">
        <Link href="/loans" className="btn btn--ghost rounded-full">
          View my loans
        </Link>
        <Link href="/apply" className="btn btn--primary rounded-full">
          Apply again
        </Link>
      </div>
    </div>
  );
}
