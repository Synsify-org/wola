"use client";
import { useEffect, useRef, useState } from "react";

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Animates from its previous displayed value to `value` on every change.
 *  Kept separate from Metric's default (plain string) rendering — this is
 *  opt-in per caller, not a behavior change for every KPI in the app. */
export default function CountUp({
  value,
  format = (n: number) => String(Math.round(n)),
  duration = 900,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
}) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
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

  return <>{format(display)}</>;
}
