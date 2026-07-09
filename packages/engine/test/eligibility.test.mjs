import { test } from "node:test";
import assert from "node:assert/strict";
import { assessEligibility } from "../dist/eligibility.js";

const base = {
  grossSalary: 10_000_000, netSalary: 10_000_000,
  internalRecoveries: 0, externalRecoveries: 0,
  isPostProbation: true, onFinalWarning: false,
  hasActiveDevelopmentLoan: false, hasActiveCarLoan: false,
};

test("advance: 1x gross, interest-free, 3 months", () => {
  const r = assessEligibility("advance", base);
  assert.equal(r.maxAmount, 10_000_000);
  assert.equal(r.interestApplies, false);
  assert.equal(r.maxTenorMonths, 3);
});
test("development: 3x gross, CBR interest, 36 months", () => {
  const r = assessEligibility("development", base);
  assert.equal(r.maxAmount, 30_000_000);
  assert.equal(r.interestApplies, true);
});
test("car: benefit-scheme formula 40% x takehome x 30 = 96m", () => {
  const r = assessEligibility("car", { ...base, internalRecoveries: 1_000_000, externalRecoveries: 1_000_000 });
  assert.equal(r.maxAmount, 96_000_000);
});
test("post-probation gate blocks everything", () => {
  assert.equal(assessEligibility("advance", { ...base, isPostProbation: false }).eligible, false);
});
test("final warning blocks everything", () => {
  assert.equal(assessEligibility("advance", { ...base, onFinalWarning: true }).eligible, false);
});
test("car blocked by active development loan", () => {
  assert.equal(assessEligibility("car", { ...base, hasActiveDevelopmentLoan: true }).eligible, false);
});
test("development blocked by active car loan", () => {
  assert.equal(assessEligibility("development", { ...base, hasActiveCarLoan: true }).eligible, false);
});