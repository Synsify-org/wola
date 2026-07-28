import Link from "next/link";
import Metric from "./metric";
import ProductMixChart from "./product-mix-chart";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();

type Book = {
  awaitingMe: number;
  totalExposure: number;
  activeLoans: number;
  principalDisbursed: number;
  interestBook: number;
};

type InboxItem = {
  applicationId: string;
  employeeName: string;
  productName: string;
  amount: number;
  tenorMonths: number;
  stageRole: string;
};

type MixRow = { name: string; kind: string; n: number; principal: number };

const roleLabel = (r: string) =>
  r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function DashboardCFO({
  book,
  inbox,
  mix,
}: {
  book: Book;
  inbox: InboxItem[];
  mix: MixRow[];
}) {
  return (
    <div className="space-y-8">
      {/* Stats strip */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric
          label="Awaiting you"
          value={String(book.awaitingMe)}
          sub={book.awaitingMe > 0 ? "Needs your decision" : "Nothing pending"}
          accent={book.awaitingMe > 0 ? "awaiting" : undefined}
        />
        <Metric
          label="Total exposure"
          value={ugx(book.totalExposure)}
          sub={"Across " + book.activeLoans + " active loan" + (book.activeLoans === 1 ? "" : "s")}
        />
        <Metric
          label="Principal disbursed"
          value={ugx(book.principalDisbursed)}
          sub="Total lent out"
        />
        <Metric
          label="Interest book"
          value={ugx(book.interestBook)}
          sub="If every loan runs to term"
        />
      </section>

      {/* Worklist: needs your decision */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Needs your decision</h2>
          {inbox.length > 0 ? (
            <Link
              href="/approvals"
              className="text-xs font-medium text-brand hover:underline"
            >
              View all
            </Link>
          ) : null}
        </div>

        {inbox.length === 0 ? (
          <div className="rounded-lg border border-rule bg-surface p-6 text-center">
            <p className="text-sm text-ink-soft">
              Nothing is waiting on you. The queue is clear.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-rule bg-surface">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th>Product</th>
                  <th className="r">Amount</th>
                  <th className="r">Tenor</th>
                  <th>Stage</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {inbox.map((item) => (
                  <tr key={item.applicationId}>
                    <td className="font-medium text-ink">{item.employeeName}</td>
                    <td className="text-ink-soft">{item.productName}</td>
                    <td className="r num">{ugx(item.amount)}</td>
                    <td className="r num">{item.tenorMonths} mo</td>
                    <td>
                      <span className="chip chip--awaiting">
                        {roleLabel(item.stageRole)}
                      </span>
                    </td>
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
      </section>

      {/* Book at a glance: chart + product table */}
      {mix.length > 0 ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <ProductMixChart data={mix} />
          <div className="overflow-hidden rounded-lg border border-rule bg-surface">
            <div className="caps px-4 pt-4">Active loans by product</div>
            <table className="ledger mt-2">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="r">Loans</th>
                  <th className="r">Principal</th>
                </tr>
              </thead>
              <tbody>
                {mix.map((m) => (
                  <tr key={m.name}>
                    <td className="font-medium text-ink">{m.name}</td>
                    <td className="r num">{m.n}</td>
                    <td className="r num">{ugx(Number(m.principal))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Personal loans: demoted to a link */}
      <section className="border-t border-rule pt-6">
        <Link
          href="/loans?mine=1"
          className="text-sm text-ink-soft hover:text-ink"
        >
          View my own loans and applications &rarr;
        </Link>
      </section>
    </div>
  );
}
