// Loan products: what staff can apply for, how much, and on what terms.
// Everyone with the administration view can read this; the CFO and
// administrators can change it (PRODUCT_EDIT_ROLES — also enforced in the
// server actions). Products are never deleted, only switched off, because
// applications and loans reference them.
import Link from "next/link";
import { ArrowRight, Plus, Settings as Cog } from "lucide-react";
import { describePricing } from "@wola/engine";
import { listProductsAdmin } from "@wola/db";
import { requireSession } from "@/lib/guard";
import { CONFIG_VIEW_ROLES, PRODUCT_EDIT_ROLES } from "@/lib/permissions";
import { KIND_LABEL, limitSummary, roleLabel } from "@/lib/product-summary";
import { pageMeta } from "@/lib/site";
import Breadcrumbs from "@/components/breadcrumbs";
import AccessDenied from "@/components/access-denied";

export const metadata = pageMeta({ title: "Loan products", description: "What staff can apply for, how much they can borrow and on what terms.", path: "/settings/products" });

export default async function ProductsPage() {
  const data = await requireSession(async (tx, ctx) => {
    if (!CONFIG_VIEW_ROLES.includes(ctx.role)) return { authorized: false as const };
    return {
      authorized: true as const,
      products: await listProductsAdmin(tx),
      canEdit: PRODUCT_EDIT_ROLES.includes(ctx.role),
    };
  });

  if (!data.authorized) {
    return (
      <AccessDenied title="Loan products" message="Loan products are available to administrators and executives only." />
    );
  }
  const { products, canEdit } = data;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Breadcrumbs items={[{ label: "Settings", href: "/settings" }, { label: "Loan products" }]} />
          <h1 className="mt-1 text-xl font-semibold text-ink">Loan products</h1>
          <p className="mt-1 text-sm text-ink-soft">
            What staff can apply for, how much they can borrow and on what terms.
          </p>
        </div>
        {canEdit ? (
          <Link href="/settings/products/new" className="btn btn--primary inline-flex h-10 items-center gap-2 rounded-full text-sm">
            <Plus className="h-4 w-4" /> New product
          </Link>
        ) : null}
      </div>

      {!canEdit ? (
        <div className="mb-4 rounded-xl bg-awaiting-wash px-4 py-2.5 text-sm text-ink">
          View only. Loan products are changed by the CFO or an administrator.
        </div>
      ) : null}

      {products.length === 0 ? (
        <div className="rounded-2xl border border-rule bg-surface p-12 text-center shadow-theme-xs">
          <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-brand-50 text-brand-600">
            <Cog className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium text-ink">No loan products yet</p>
          <p className="mt-1 text-sm text-ink-soft">
            {canEdit ? "Create the first one so staff have something to apply for." : "An administrator needs to create the first one."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {products.map((p) => {
            const needsRouting = p.active && p.chain.length === 0;
            const needsRate = p.active && p.interestApplies && p.currentRate === null;
            return (
              <li key={p.id}>
                <Link
                  href={`/settings/products/${p.id}`}
                  className={"flex h-full flex-col rounded-2xl border border-rule bg-surface p-5 shadow-theme-xs transition-colors hover:border-brand-200 hover:bg-brand-wash " + (p.active ? "" : "opacity-75")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-semibold text-ink">{p.name}</h2>
                        <span className={p.active ? "chip chip--approved" : "chip"}>{p.active ? "On" : "Off"}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-soft">{KIND_LABEL[p.kind] ?? p.kind}</p>
                    </div>
                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-ink-faint" />
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div className="col-span-2">
                      <dt className="caps">Limit</dt>
                      <dd className="mt-0.5 text-ink">{limitSummary(p)}</dd>
                    </div>
                    <div>
                      <dt className="caps">Longest term</dt>
                      <dd className="mt-0.5 text-ink">{p.maxTenorMonths} months</dd>
                    </div>
                    <div>
                      <dt className="caps">Interest</dt>
                      <dd className="mt-0.5 text-ink">
                        {describePricing({ ...p, indexName: p.rateIndexName })}
                        {p.interestApplies && p.currentRate !== null ? (
                          <span className="text-ink-soft"> · {+(p.currentRate * 100).toFixed(2)}% now</span>
                        ) : null}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="caps">Approved by</dt>
                      <dd className="mt-0.5 text-ink">
                        {p.chain.length ? p.chain.map(roleLabel).join(" → ") : <span className="text-rejected">Nobody yet</span>}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-rule pt-3 text-xs text-ink-soft">
                    <span>{p.applications} application{p.applications === 1 ? "" : "s"}</span>
                    <span>{p.activeLoans} running loan{p.activeLoans === 1 ? "" : "s"}</span>
                    {p.inReview > 0 ? <span className="font-medium text-awaiting">{p.inReview} in review</span> : null}
                  </div>

                  {needsRouting || needsRate ? (
                    <div className="mt-3 rounded-lg bg-rejected-wash px-3 py-2 text-xs text-rejected">
                      {needsRouting ? "No approvers set up — applications can't be approved. " : ""}
                      {needsRate ? "Charges interest but has no rate set." : ""}
                    </div>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
