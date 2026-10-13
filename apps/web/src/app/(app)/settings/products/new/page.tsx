import Link from "next/link";
import { redirect } from "next/navigation";
import { listCurrentRateIndices, listProductsAdmin } from "@wola/db";
import { requireSession } from "@/lib/guard";
import { PRODUCT_EDIT_ROLES } from "@/lib/permissions";
import ProductForm from "@/components/product-form";

export default async function NewProductPage() {
  const data = await requireSession(async (tx, ctx) => {
    if (!PRODUCT_EDIT_ROLES.includes(ctx.role)) return null;
    return {
      rates: await listCurrentRateIndices(tx, ctx.tenantId),
      products: await listProductsAdmin(tx),
    };
  });
  if (!data) redirect("/settings/products");

  return (
    <>
      <div className="mb-6">
        <Link href="/settings/products" className="text-xs font-medium text-ink-soft hover:text-ink">← Loan products</Link>
        <h1 className="mt-1 text-xl font-semibold text-ink">New loan product</h1>
        <p className="mt-1 text-sm text-ink-soft">Staff will see it on the apply form as soon as it&apos;s saved.</p>
      </div>
      <div className="max-w-3xl">
        <ProductForm
          initial={null}
          canEdit
          rates={data.rates.map((r) => ({ name: r.name, currentValue: r.currentValue }))}
          otherProducts={data.products.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }))}
        />
      </div>
    </>
  );
}
