"use client";
// Lazy entry point: the chart itself (and recharts) lives in trend-line-chart-impl.tsx
// and loads after the page is interactive. See lazy-chart.tsx.
import { lazyChart } from "./lazy-chart";

export type { TrendSeries } from "./trend-line-chart-impl";
export default lazyChart(() => import("./trend-line-chart-impl"));
