// packages/engine/src/pricing.ts
// What annual rate does a product charge? One function, used by the database
// layer (when quoting an application), the apply form (to show the rate before
// someone applies) and the admin form (live preview) — so they can never
// disagree about the number.
//
// All rates in/out: percent in, FRACTION out (9.5 -> 0.095), matching how
// loans.annual_rate is stored.

export type RateMode = "index" | "fixed";

export interface PricingInput {
  interestApplies: boolean;
  rateMode: RateMode;
  /** Percent; used when rateMode === "fixed". */
  fixedRate: number | null;
  /** Percentage points added to the index; may be negative. */
  rateMargin: number;
  /** The linked index's current value, percent; null when none is linked. */
  indexValue: number | null;
}

/** The annual rate as a fraction, or null when it can't be determined
 *  (index product with no index, fixed product with no rate). Callers must
 *  treat null as "refuse", never guess. Interest off => 0. The result is
 *  floored at 0: a discount margin can't push the rate negative. */
export function effectiveAnnualRate(p: PricingInput): number | null {
  if (!p.interestApplies) return 0;
  if (p.rateMode === "fixed") {
    return p.fixedRate === null || !Number.isFinite(p.fixedRate) ? null : Math.max(0, p.fixedRate) / 100;
  }
  if (p.indexValue === null || !Number.isFinite(p.indexValue)) return null;
  return Math.max(0, p.indexValue + (Number.isFinite(p.rateMargin) ? p.rateMargin : 0)) / 100;
}

/** Plain-language pricing, e.g. "CBR + 2%", "CBR − 3%", "Fixed 12%", "Interest-free". */
export function describePricing(
  p: Pick<PricingInput, "interestApplies" | "rateMode" | "fixedRate" | "rateMargin"> & { indexName: string | null },
): string {
  if (!p.interestApplies) return "Interest-free";
  if (p.rateMode === "fixed") return `Fixed ${p.fixedRate ?? "?"}%`;
  const name = p.indexName ?? "rate";
  if (!p.rateMargin) return `Follows ${name}`;
  return `${name} ${p.rateMargin > 0 ? "+" : "−"} ${Math.abs(p.rateMargin)}%`;
}
