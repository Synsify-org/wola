import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveAnnualRate, describePricing } from "../dist/index.js";

const idx = (over = {}) => ({ interestApplies: true, rateMode: "index", fixedRate: null, rateMargin: 0, indexValue: 9.5, ...over });

test("index products charge the index, plus or minus the margin", () => {
  assert.equal(effectiveAnnualRate(idx()), 0.095);
  assert.ok(Math.abs(effectiveAnnualRate(idx({ rateMargin: 2 })) - 0.115) < 1e-12);
  assert.ok(Math.abs(effectiveAnnualRate(idx({ rateMargin: -3 })) - 0.065) < 1e-12);
});

test("a discount can never push the rate below zero", () => {
  assert.equal(effectiveAnnualRate(idx({ rateMargin: -20 })), 0);
});

test("fixed products ignore the index entirely", () => {
  assert.equal(effectiveAnnualRate(idx({ rateMode: "fixed", fixedRate: 12, indexValue: 99 })), 0.12);
  assert.equal(effectiveAnnualRate(idx({ rateMode: "fixed", fixedRate: 12, indexValue: null })), 0.12);
});

test("an undeterminable rate is null — callers must refuse, not guess", () => {
  assert.equal(effectiveAnnualRate(idx({ indexValue: null })), null);
  assert.equal(effectiveAnnualRate(idx({ rateMode: "fixed", fixedRate: null })), null);
});

test("interest off is exactly zero, whatever else is configured", () => {
  assert.equal(effectiveAnnualRate(idx({ interestApplies: false, indexValue: null })), 0);
});

test("pricing reads in plain language", () => {
  const d = (o) => describePricing({ interestApplies: true, rateMode: "index", fixedRate: null, rateMargin: 0, indexName: "CBR", ...o });
  assert.equal(d({}), "Follows CBR");
  assert.equal(d({ rateMargin: 2 }), "CBR + 2%");
  assert.equal(d({ rateMargin: -3 }), "CBR − 3%");
  assert.equal(d({ rateMode: "fixed", fixedRate: 12 }), "Fixed 12%");
  assert.equal(d({ interestApplies: false }), "Interest-free");
});
