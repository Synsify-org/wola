"use client";
import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@wola/engine";

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

type Format = "integer" | "money" | "percent" | "days";

// A string key, not a function — this component is rendered from plain
// Server Components (the dashboards), and a function prop can't cross the
// server/client boundary ("Functions cannot be passed directly to Client
// Components"). Add a case here rather than accepting an arbitrary formatter.
// `currency` is only consulted for format="money"; formatMoney itself is a
// pure function (no I/O), safe to call from a Client Component.
function formatValue(n: number, format: Format, currency: string): string {
  switch (format) {
    case "money": return formatMoney(n, currency);
    case "percent": return Math.round(n) + "%";
    case "days": return n.toFixed(1) + "d";
    default: return String(Math.round(n));
  }
}

/** Animates from its previous displayed value to `value` on every change.
 *  Kept separate from Metric's default (plain string) rendering — this is
 *  opt-in per caller, not a behavior change for every KPI in the app. */
export default function CountUp({
  value,
  format = "integer",
  currency = "UGX",
  duration = 900,
}: {
  value: number;
  format?: Format;
  /** Only used when format="money". Defaults to UGX so callers mid-migration
   *  to per-tenant currency don't silently break. */
  currency?: string;
  duration?: number;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const startRef = useRef<number | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    // Skip the animation on mount — show the real value immediately (no
    // flash-of-zero, no gratuitous count-up on every page load). Only
    // animate genuine changes to `value` after that.
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    fromRef.current = display;
    startRef.current = null;
    let raf = 0;

    function step(ts: number) {
      if (startRef.current === null) startRef.current = ts;
      const t = Math.min((ts - startRef.current) / duration, 1);
      const eased = easeOutCubic(t);
      setDisplay(fromRef.current + (value - fromRef.current) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // Intentionally NOT depending on `display` — it's read once per `value`
    // change to capture the animation's start point, not to re-trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return <>{formatValue(display, format, currency)}</>;
}
