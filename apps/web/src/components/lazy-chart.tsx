"use client";
// Charts pull in recharts (~400 KB raw, ~94 KB gzipped), which used to be
// downloaded and parsed before ANY dashboard became interactive, even for charts
// far below the fold. `lazyChart` loads a chart's implementation only once its
// placeholder is within ~400px of the viewport, behind a skeleton of the same
// footprint (so the layout doesn't jump). The rest of the page never waits for
// it, and someone who never scrolls to a chart never downloads recharts for it.
//
//   export default lazyChart(() => import("./trend-line-chart-impl"));
//
// Server render and first client render both show the skeleton; it keeps the
// chart's grid placement (`className`), which next/dynamic's loader can't see.
import {
  lazy, Suspense, useCallback, useEffect, useState, useSyncExternalStore,
  type ComponentType, type Ref,
} from "react";
import { Skeleton } from "@/components/ui/skeleton";

const subscribe = () => () => {};
const useMounted = () => useSyncExternalStore(subscribe, () => true, () => false);

/** True once `el` has been within `margin` of the viewport (and stays true).
 *  Falls back to "visible" where IntersectionObserver is missing. */
function useNearViewport(margin = "400px"): [Ref<HTMLElement>, boolean] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [near, setNear] = useState(false);
  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);
  useEffect(() => {
    if (near || !el) return;
    if (typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); } },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el, near, margin]);
  return [ref, near];
}

export function ChartFallback({
  className = "", tall = false, innerRef,
}: { className?: string; tall?: boolean; innerRef?: Ref<HTMLElement> }) {
  return (
    <div
      ref={innerRef as Ref<HTMLDivElement>}
      className={
        "flex h-full min-w-0 flex-col rounded-2xl border border-rule bg-surface p-5 shadow-theme-xs sm:p-6 " + className
      }
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading chart</span>
      <Skeleton className="h-5 w-40" />
      <Skeleton className={"mt-5 w-full " + (tall ? "h-72 sm:h-80" : "h-56 sm:h-64")} />
    </div>
  );
}

export function lazyChart<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  /** tall: taller skeleton; bare: a plain skeleton block of this height class
   *  (for charts that already sit inside a card). */
  opts: { tall?: boolean; bare?: string } = {},
): ComponentType<P> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Chart = lazy(load) as unknown as ComponentType<any>;
  return function LazyChart(props: P) {
    const mounted = useMounted();
    const [ref, near] = useNearViewport();
    const fallback = opts.bare ? (
      <div ref={ref as Ref<HTMLDivElement>} role="status" aria-busy="true">
        <span className="sr-only">Loading chart</span>
        <Skeleton className={"w-full " + opts.bare} />
      </div>
    ) : (
      <ChartFallback
        innerRef={ref}
        className={(props as { className?: string }).className}
        tall={opts.tall}
      />
    );
    if (!mounted || !near) return fallback;
    return (
      <Suspense fallback={fallback}>
        <Chart {...props} />
      </Suspense>
    );
  };
}
