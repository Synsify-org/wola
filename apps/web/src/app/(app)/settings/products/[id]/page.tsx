import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { GitBranch } from "lucide-react";
import { getProductAdmin, listCurrentRateIndices, listProductsAdmin } from "@wola/db";
import { requireSession } from "@/lib/guard";
import { CONFIG_VIEW_ROLES, PRODUCT_EDIT_ROLES } from "@/lib/permissions";
import ProductForm from "@/components/product-form";

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { id } = await params;
  const { created } = await searchParams;
  // A malformed id would make Postgres throw on the uuid cast.
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const data = await requireSession(async (tx, ctx) => {
    if (!CONFIG_VIEW_ROLES.includes(ctx.role)) return { denied: true as const };
    const product = await getProductAdmin(tx, id);
    if (!product) return { denied: false as const, product: null };
    return {
      denied: false as const,
      product,
      rates: await listCurrentRateIndices(tx, ctx.tenantId),
      products: await listProductsAdmin(tx),
      canEdit: PRODUCT_EDIT_ROLES.includes(ctx.role),
    };
  });
  if (data.denied) redirect("/");
  if (!data.product) notFound();
  const { product, rates, products, canEdit } = data;

  return (
    <>
      <div className="mb-6">
        <Link href="/settings/products" className="text-xs font-medium text-ink-soft hover:text-ink">← Loan products</Link>
        <h1 className="mt-1 text-xl font-semibold text-ink">{product.name}</h1>
      </div>

      {created ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-approved-wash px-4 py-2.5 text-sm text-approved">
          <span>Product created.{product.chain.length === 0 ? " Next, choose who approves it." : ""}</span>
          {product.chain.length === 0 ? (
            <Link href="/settings/routing" className="inline-flex items-center gap-1.5 font-semibold underline">
              <GitBranch className="h-4 w-4" /> Set up approvers
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="max-w-3xl">
        <ProductForm
          key={product.id + String(product.active)}
          initial={product}
          canEdit={canEdit}
          rates={rates.map((r) => ({ name: r.name, currentValue: r.currentValue }))}
          otherProducts={products.filter((p) => p.id !== product.id && (p.active || product.excludes.includes(p.id))).map((p) => ({ id: p.id, name: p.name }))}
        />
      </div>
    </>
  );
}
