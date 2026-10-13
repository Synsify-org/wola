import { test } from "node:test";
import assert from "node:assert/strict";
import { validateProductConfig, validateStages, sameChain } from "../dist/index.js";

const base = {
  name: "Salary Advance", kind: "advance", capMethod: "salary_multiple", capBasis: "gross",
  capMultiple: 1, takehomeFactor: null, takehomeMultiplier: null, maxTenorMonths: 3,
  interestApplies: true, rateMode: "index", rateIndexName: "BoU CBR", rateMargin: 0, fixedRate: null,
  requiresPostProbation: true, blockedByFinalWarning: true, requiresExternalDeclaration: false, excludes: [],
};

test("a complete salary-multiple product is valid", () => {
  assert.deepEqual(validateProductConfig(base), {});
});

test("a complete take-home product is valid", () => {
  const p = { ...base, kind: "asset", capMethod: "takehome_factor", capMultiple: null, takehomeFactor: 0.4, takehomeMultiplier: 30, maxTenorMonths: 48 };
  assert.deepEqual(validateProductConfig(p), {});
});

test("interest without a rate index is rejected (resolveRate would refuse it at approval)", () => {
  assert.match(validateProductConfig({ ...base, rateIndexName: null }).rateIndexName, /rate/i);
  assert.deepEqual(validateProductConfig({ ...base, interestApplies: false, rateIndexName: null }), {});
});

test("missing or absurd numbers are flagged per field", () => {
  const e = validateProductConfig({ ...base, name: " ", capMultiple: 0, maxTenorMonths: 0 });
  assert.ok(e.name && e.capMultiple && e.maxTenorMonths);
  const t = validateProductConfig({ ...base, capMethod: "takehome_factor", capMultiple: null, takehomeFactor: 1.5, takehomeMultiplier: null });
  assert.ok(t.takehomeFactor && t.takehomeMultiplier);
  assert.ok(validateProductConfig({ ...base, maxTenorMonths: 2.5 }).maxTenorMonths);
});

test("a product cannot exclude itself", () => {
  assert.ok(validateProductConfig({ ...base, excludes: ["p1"] }, "p1").excludes);
});

test("chains: need a stage, known approvers, no duplicates, sane SLA", () => {
  const s = (role, slaHours = null) => ({ role, slaHours, allowDelegation: true });
  assert.equal(validateStages([], { required: true }).ok, false);
  assert.equal(validateStages([], { required: false }).ok, true);
  assert.equal(validateStages([s("hr"), s("cfo"), s("ceo")], { required: true }).ok, true);
  assert.equal(validateStages([s("hr"), s("hr")], { required: true }).ok, false);
  assert.equal(validateStages([s("org_admin")], { required: true }).ok, false);
  assert.equal(validateStages([s("hr", 0)], { required: true }).ok, false);
  assert.equal(validateStages([s("hr", 24)], { required: true }).ok, true);
});

test("sameChain ignores SLA/delegation but not order", () => {
  assert.equal(sameChain([{ role: "hr" }, { role: "cfo" }], [{ role: "hr" }, { role: "cfo" }]), true);
  assert.equal(sameChain([{ role: "hr" }, { role: "cfo" }], [{ role: "cfo" }, { role: "hr" }]), false);
});

test("fixed-rate products need a sensible rate, and no index", () => {
  const fixed = { ...base, rateMode: "fixed", rateIndexName: null, fixedRate: 12 };
  assert.deepEqual(validateProductConfig(fixed), {});
  assert.ok(validateProductConfig({ ...fixed, fixedRate: null }).fixedRate);
  assert.ok(validateProductConfig({ ...fixed, fixedRate: 0 }).fixedRate);
  assert.ok(validateProductConfig({ ...fixed, fixedRate: 250 }).fixedRate);
});

test("index margin must be sane and may be negative", () => {
  assert.deepEqual(validateProductConfig({ ...base, rateMargin: -3 }), {});
  assert.ok(validateProductConfig({ ...base, rateMargin: 80 }).rateMargin);
  assert.ok(validateProductConfig({ ...base, rateMargin: NaN }).rateMargin);
});
