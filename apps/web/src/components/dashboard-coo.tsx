import DecisionQueue from "./decision-queue";
import Metric from "./metric";
import CountUp from "./count-up";
import { Wallet, Layers, Banknote, TrendingUp } from "lucide-react";

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
  currency,
}: {
  inbox: COOInboxItem[];
  totalExposure: number;
  activeLoans: number;
  principalDisbursed: number;
  interestBook: number;
  currency: string;
}) {
  return (
    <div className="space-y-4 xl:space-y-5">
      {/* Compact book row — context, not a hero. Sits right under the
          welcome banner on every dashboard now (user request). */}
      <section className="grid grid-cols-1 gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
        <Metric label="Total exposure" value={<CountUp value={totalExposure} format="money" currency={currency} />} sub="Current outstanding" icon={Wallet} accent="brand" />
        <Metric label="Active loans" value={<CountUp value={activeLoans} />} sub="Across the whole book" icon={Layers} accent="brand" />
        <Metric label="Principal disbursed" value={<CountUp value={principalDisbursed} format="money" currency={currency} />} sub="Total lent out" icon={Banknote} accent="brand" />
        <Metric label="Interest book" value={<CountUp value={interestBook} format="money" currency={currency} />} sub="If every loan runs to term" icon={TrendingUp} accent="brand" />
      </section>

      <DecisionQueue
        title="Awaiting you at your stage"
        items={inbox}
        currency={currency}
        emptyText="Nothing awaiting you."
        className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150"
      />
    </div>
  );
}
