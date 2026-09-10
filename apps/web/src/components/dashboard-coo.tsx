import Link from "next/link";
import Metric from "./metric";
import { Wallet, Layers, Banknote, TrendingUp } from "lucide-react";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();

export type COOInboxItem = {
  applicationId: string;
  employeeName: string;
  productName: string;
  amount: number;
};

// The lightest oversight dashboard: "what is waiting at my stage." A short
// queue over a compact book row — no trend, no money operations, no employee
// register. Whether this role has anything to approve at all is tenant
// configuration (some tenants' pipelines don't include a coo/group_ceo
// stage); an empty queue here just means this tenant's pipeline doesn't
// route through this role, which is a calm, expected state, not an error.
export default function DashboardCOO({
  inbox,
  totalExposure,
  activeLoans,
  principalDisbursed,
  interestBook,
}: {
  inbox: COOInboxItem[];
  totalExposure: number;
  activeLoans: number;
  principalDisbursed: number;
  interestBook: number;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-soft">What is waiting at my stage?</p>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Awaiting you at your stage</h2>
          {inbox.length > 0 ? (
            <Link href="/approvals" className="text-xs font-medium text-brand hover:underline">
              View all
            </Link>
          ) : null}
        </div>
        {inbox.length === 0 ? (
          <div className="rounded-xl border border-rule bg-surface p-6 text-center shadow-theme-sm">
            <p className="text-sm text-ink-soft">Nothing awaiting you.</p>
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

      {/* Compact book row — context, not a hero. */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Total exposure" value={ugx(totalExposure)} icon={Wallet} accent="brand" />
        <Metric label="Active loans" value={String(activeLoans)} icon={Layers} accent="brand" />
        <Metric label="Principal disbursed" value={ugx(principalDisbursed)} icon={Banknote} accent="brand" />
        <Metric label="Interest book" value={ugx(interestBook)} icon={TrendingUp} accent="brand" />
      </section>
    </div>
  );
}
