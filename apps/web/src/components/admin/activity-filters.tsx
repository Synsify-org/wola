"use client";
// The Activity page's filters. They apply as you change them: pick an organisation and the
// list updates; type in the search box and it updates a moment after you stop. The address
// always holds the filter, so a filtered view can be bookmarked or shared, and Back works.
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { OptionSelect } from "@/components/ui/select";

const ALL = "__all__"; // Radix Select cannot hold an empty-string value

export default function ActivityFilters({
  view,
  tenant,
  q,
  tenants,
}: {
  view: string;
  tenant: string;
  q: string;
  tenants: { slug: string; name: string }[];
}) {
  const router = useRouter();
  const path = usePathname();
  const [pending, start] = useTransition();
  const [text, setText] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The address is the source of truth: if it changes (Back, a tab click) the box follows it.
  useEffect(() => setText(q), [q]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function go(next: { tenant?: string; q?: string }) {
    const params = new URLSearchParams({ view });
    const t = next.tenant ?? tenant;
    const s = (next.q ?? text).trim();
    if (t) params.set("tenant", t);
    if (s) params.set("q", s);
    start(() => router.replace(`${path}?${params.toString()}`, { scroll: false }));
  }

  const filtered = Boolean(tenant || q || text);

  return (
    <div className="mb-5 flex flex-wrap items-end gap-3" role="search" aria-label="Filter activity">
      <div className="text-xs text-ink-soft">
        Organisation
        <OptionSelect
          ariaLabel="Organisation"
          className="mt-1 w-56 max-w-full"
          value={tenant || ALL}
          onValueChange={(v) => go({ tenant: v === ALL ? "" : v })}
          options={[{ value: ALL, label: "All organisations" }, ...tenants.map((t) => ({ value: t.slug, label: t.name }))]}
        />
      </div>

      <label className="text-xs text-ink-soft">
        Search
        <span className="relative mt-1 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <input
            value={text}
            onChange={(e) => {
              const v = e.target.value;
              setText(v);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => go({ q: v }), 350);
            }}
            onKeyDown={(e) => { if (e.key === "Enter") { if (timer.current) clearTimeout(timer.current); go({ q: text }); } }}
            placeholder="action, person…"
            className="block h-10 w-64 max-w-full rounded-xl border border-rule bg-surface pl-9 pr-3 text-sm text-ink shadow-theme-xs outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint hover:border-ink-faint/50 focus:border-brand-300 focus:ring-4 focus:ring-brand-100"
          />
        </span>
      </label>

      <div className="flex h-10 items-center gap-3 text-sm">
        {pending ? <Loader2 className="h-4 w-4 animate-spin text-ink-faint" aria-label="Updating" /> : null}
        {filtered ? (
          <button
            type="button"
            onClick={() => { if (timer.current) clearTimeout(timer.current); setText(""); start(() => router.replace(`${path}?view=${view}`, { scroll: false })); }}
            className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
