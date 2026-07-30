const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();
const shortDate = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

type Line = {
  period: number;
  dueDate: string;
  instalment: number;
  principal: number;
  interest: number;
  balance: number;
};

export default function ScheduleTable({
  schedule,
  annualRate,
}: {
  schedule: Line[];
  annualRate: number | null;
}) {
  if (schedule.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-rule bg-surface shadow-theme-sm">
      <div className="flex items-center justify-between px-5 pt-4">
        <div className="caps">Repayment schedule</div>
        {annualRate != null ? (
          <span className="num text-xs text-ink-soft">
            {annualRate.toFixed(1)}% p.a. · {schedule.length} instalments
          </span>
        ) : null}
      </div>
      <div className="mt-2 max-h-112 overflow-y-auto">
        <table className="ledger">
          <thead className="sticky top-0">
            <tr>
              <th>#</th>
              <th>Due date</th>
              <th className="r">Payment</th>
              <th className="r">Principal</th>
              <th className="r">Interest</th>
              <th className="r">Balance</th>
            </tr>
          </thead>
          <tbody>
            {schedule.map((l) => (
              <tr key={l.period}>
                <td className="num text-ink-faint">{l.period}</td>
                <td className="num">{shortDate(l.dueDate)}</td>
                <td className="r num font-medium text-ink">{ugx(l.instalment)}</td>
                <td className="r num text-ink-soft">{ugx(l.principal)}</td>
                <td className="r num text-ink-soft">{ugx(l.interest)}</td>
                <td className="r num text-ink">{ugx(l.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}