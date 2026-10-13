"use client";
// Lazy entry point; see lazy-chart.tsx and loan-size-chart-impl.tsx.
import { lazyChart } from "./lazy-chart";

export type { SizeBand } from "./loan-size-chart-impl";
export default lazyChart(() => import("./loan-size-chart-impl"));
