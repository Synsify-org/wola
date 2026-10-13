"use client";
// Lazy entry point; see lazy-chart.tsx and book-breakup-impl.tsx.
import { lazyChart } from "./lazy-chart";

export default lazyChart(() => import("./book-breakup-impl"), { tall: true });
