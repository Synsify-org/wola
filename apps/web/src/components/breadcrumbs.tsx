// Visible breadcrumb trail for nested pages ("Settings / Loan products / Edit"),
// with the same trail as schema.org BreadcrumbList data. The last item is the
// current page (not a link, aria-current="page"). Server component: it reads the
// request origin to make the structured-data URLs absolute.
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import JsonLd from "./json-ld";
import { siteOrigin } from "@/lib/site";

export type Crumb = { label: string; href?: string };

export default async function Breadcrumbs({ items }: { items: Crumb[] }) {
  const origin = await siteOrigin();
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3">
        <ol className="flex flex-wrap items-center gap-1 text-xs text-ink-soft">
          {items.map((c, i) => {
            const last = i === items.length - 1;
            return (
              <li key={c.label} className="flex items-center gap-1">
                {i > 0 ? <ChevronRight className="h-3 w-3 text-ink-faint" aria-hidden /> : null}
                {c.href && !last ? (
                  <Link href={c.href} className="font-medium hover:text-ink hover:underline">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current={last ? "page" : undefined} className={last ? "font-medium text-ink" : ""}>
                    {c.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: items.map((c, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: c.label,
            ...(c.href ? { item: `${origin}${c.href}` } : {}),
          })),
        }}
      />
    </>
  );
}
