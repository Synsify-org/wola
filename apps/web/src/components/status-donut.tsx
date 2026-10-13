"use client";
// Lazy entry point; see lazy-chart.tsx and status-donut-impl.tsx.
import { lazyChart } from "./lazy-chart";

export default lazyChart(() => import("./status-donut-impl"), { bare: "h-[160px]" });
