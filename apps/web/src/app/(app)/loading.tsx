"use client";
// apps/web/src/app/(app)/loading.tsx
// Route-level loading fallback for every authenticated page. It replaces only
// the content area (Shell lives in (app)/layout.tsx), so the sidebar/topbar
// stay put during navigation. A lone spinner told you nothing about what was
// coming; these placeholders match the page that's about to appear (the
// dashboard's banner / tabs / KPI row / chart, or a list page's title / toolbar
// / rows) so the swap doesn't jump. The per-link spinner in nav-links.tsx still
// gives instant feedback on the click itself.
import { usePathname } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";

const card = "rounded-2xl border border-rule bg-surface shadow-theme-xs";

function DashboardSkeleton() {
  return (
    <div className="space-y-4 xl:space-y-5">
      {/* welcome banner */}
      <Skeleton className="h-36 w-full rounded-2xl sm:h-40" />
      {/* Overview | Rejections tabs */}
      <div className="flex gap-6 border-b border-rule pb-3">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-20" />
      </div>
      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={card + " p-4 sm:p-5"}>
            <div className="flex items-start justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-5 rounded-full" />
            </div>
            <Skeleton className="mt-5 h-8 w-40" />
            <Skeleton className="mt-3 h-3 w-32" />
          </div>
        ))}
      </div>
      {/* chart + side card */}
      <div className="grid gap-4 lg:grid-cols-3 xl:gap-5">
        <div className={card + " p-5 lg:col-span-2"}>
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-4 h-52 w-full sm:h-64" />
        </div>
        <div className={card + " hidden p-5 lg:block"}>
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mx-auto mt-6 size-32 rounded-full" />
        </div>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-4">
      <div>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-2 h-4 w-64 max-w-full" />
      </div>
      <div className={card + " flex flex-wrap gap-3 p-3"}>
        <Skeleton className="h-10 min-w-[12rem] flex-1" />
        <Skeleton className="hidden h-10 w-32 sm:block" />
        <Skeleton className="hidden h-10 w-32 sm:block" />
      </div>
      <div className={card + " divide-y divide-rule"}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-40 max-w-full" />
              <Skeleton className="h-3 w-56 max-w-full" />
            </div>
            <Skeleton className="h-4 w-20 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Loading() {
  const pathname = usePathname();
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {pathname === "/" ? <DashboardSkeleton /> : <ListSkeleton />}
    </div>
  );
}
