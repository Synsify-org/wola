import { test } from "node:test";
import assert from "node:assert/strict";
import { assessEligibility } from "../dist/eligibility.js";

const emp = {
  grossSalary: 10_000_000,
  netSalary: 10_000_000,
  internalRecoveries: 0,
  externalRecoveries: 0,
  isPostProbation: true,
  onFinalWarning: false,
  activeProductIds: [],
};

// ── MUA''s benefit scheme, expressed purely as configuration ──────────
const muaAdvance = {
  productId: "p-adv", name: "Salary Advance",
  capMethod: "salary_multiple", capBasis: "gross", capMultiple: 1,
  takehomeFactor: null, takehomeMultiplier: null,
  maxTenorMonths: 3, interestApplies: false,
  requiresPostProbation: true, blockedByFinalWarning: true,
  requiresExternalDeclaration: false, excludes: [],
};
const muaDevelopment = {
  productId: "p-dev", name: "Development Loan",
  capMethod: "salary_multiple", capBasis: "gross", capMultiple: 3,
  takehomeFactor: null, takehomeMultiplier: null,
  maxTenorMonths: 36, interestApplies: true,
  requiresPostProbation: true, blockedByFinalWarning: true,
  requiresExternalDeclaration: false, excludes: ["p-car"],
};
const muaCar = {
  productId: "p-car", name: "Staff Car Loan",
  capMethod: "takehome_factor", capBasis: "net", capMultiple: null,
  takehomeFactor: 0.4, takehomeMultiplier: 30,
  maxTenorMonths: 36, interestApplies: true,
  requiresPostProbation: true, blockedByFinalWarning: true,
  requiresExternalDeclaration: true, excludes: ["p-dev"],
};

test("MUA advance: 1x gross, interest-free, 3 months", () => {
  const r = assessEligibility(muaAdvance, emp);
  assert.equal(r.maxAmount, 10_000_000);
  assert.equal(r.interestApplies, false);
  assert.equal(r.maxTenorMonths, 3);
});

test("MUA development: 3x gross", () => {
  assert.equal(assessEligibility(muaDevelopment, emp).maxAmount, 30_000_000);
});

test("MUA car: 40% x take-home x 30 (signed benefit scheme)", () => {
  const r = assessEligibility(muaCar, {
    ...emp, internalRecoveries: 1_000_000, externalRecoveries: 1_000_000,
  });
  assert.equal(r.maxAmount, 96_000_000);   // 8m x 0.4 x 30
});

test("post-probation gate blocks, when the tenant configures it", () => {
  assert.equal(
    assessEligibility(muaAdvance, { ...emp, isPostProbation: false }).eligible,
    false,
  );
});

test("a tenant that does NOT gate on probation lets it through", () => {
  const relaxed = { ...muaAdvance, requiresPostProbation: false };
  assert.equal(
    assessEligibility(relaxed, { ...emp, isPostProbation: false }).eligible,
    true,
  );
});

test("final warning blocks, when configured", () => {
  assert.equal(
    assessEligibility(muaAdvance, { ...emp, onFinalWarning: true }).eligible,
    false,
  );
});

test("exclusions are configured, not hardcoded: car blocks development", () => {
  const holdingCar = { ...emp, activeProductIds: ["p-car"] };
  assert.equal(assessEligibility(muaDevelopment, holdingCar).eligible, false);
});

test("an advance may run alongside a car loan (not excluded)", () => {
  const holdingCar = { ...emp, activeProductIds: ["p-car"] };
  assert.equal(assessEligibility(muaAdvance, holdingCar).eligible, true);
});

// ── A DIFFERENT institution. No code change. ──────────────────────────
test("a SACCO scheme works with no code change: 4x NET over 48 months", () => {
  const sacco = {
    productId: "s-1", name: "Member Loan",
    capMethod: "salary_multiple", capBasis: "net", capMultiple: 4,
    takehomeFactor: null, takehomeMultiplier: null,
    maxTenorMonths: 48, interestApplies: true,
    requiresPostProbation: false, blockedByFinalWarning: false,
    requiresExternalDeclaration: false, excludes: [],
  };
  const r = assessEligibility(sacco, { ...emp, netSalary: 2_000_000 });
  assert.equal(r.maxAmount, 8_000_000);
  assert.equal(r.maxTenorMonths, 48);
});

test("MUA can change the car factor without a deploy", () => {
  // If MUA confirms the briefing example (no 40%), an admin sets factor = 1.
  const revised = { ...muaCar, takehomeFactor: 1 };
  const r = assessEligibility(revised, {
    ...emp, internalRecoveries: 1_000_000, externalRecoveries: 1_000_000,
  });
  assert.equal(r.maxAmount, 240_000_000);   // 8m x 1 x 30
});
