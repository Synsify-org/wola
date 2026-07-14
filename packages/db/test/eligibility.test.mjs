// packages/db/test/eligibility.test.mjs
// Pins MUA's benefit scheme AS CONFIGURED. Migration 0008 moved the lending
// rules out of code and into loan_products columns — out from under the test
// suite. This file asserts the engine computes the confirmed caps from that
// config shape.
//
// NOTE: this seeds its OWN tenant. An earlier version read the dev seed
// (testco) and failed in CI, which never runs seed-dev.sql. Shared fixtures rot;
// every other test file here owns its own, and so does this one.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { loadProductRules } from "../src/product-rules.ts";
import { assessEligibility } from "@wola/engine";

const APP = process.env.DATABASE_URL;
const ADMIN = process.env.DATABASE_ADMIN_URL;
let app, admin, T;

const inTenant = (fn) =>
  app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${T}, true)`;
    return fn(tx);
  });

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 2 });

  await admin`DELETE FROM tenants WHERE slug = 'elig-t'`;
  const [t] = await admin`INSERT INTO tenants (slug,name,status)
    VALUES ('elig-t','Eligibility Test','active') RETURNING id`;
  T = t.id;

  // MUA's benefit scheme AS CONFIGURED. These numbers are the contract.
  await admin`INSERT INTO loan_products
    (tenant_id, name, kind, cap_method, cap_basis, cap_multiple,
     max_tenor_months, interest_applies)
    VALUES (${T}, 'Salary Advance', 'advance', 'salary_multiple', 'gross', 1, 3, false)`;

  await admin`INSERT INTO loan_products
    (tenant_id, name, kind, cap_method, cap_basis, cap_multiple,
     max_tenor_months, interest_applies)
    VALUES (${T}, 'Development Loan', 'term', 'salary_multiple', 'gross', 3, 36, true)`;

  await admin`INSERT INTO loan_products
    (tenant_id, name, kind, cap_method, cap_basis,
     takehome_factor, takehome_multiplier, max_tenor_months,
     interest_applies, requires_external_declaration)
    VALUES (${T}, 'Staff Car Loan', 'asset', 'takehome_factor', 'net',
            0.4, 30, 36, true, true)`;
});

after(async () => {
  await admin`DELETE FROM tenants WHERE slug = 'elig-t'`;
  await app.end();
  await admin.end();
});

// The employee from the benefit-scheme spec: gross 10m, net 8m, no recoveries.
const specEmployee = {
  grossSalary: 10000000,
  netSalary: 8000000,
  internalRecoveries: 0,
  externalRecoveries: 0,
  isPostProbation: true,
  onFinalWarning: false,
  activeProductIds: [],
};

test("car loan: config yields the CONFIRMED 96m cap", async () => {
  // Confirmed with MUA HR, 2026-07-14:  (net - recoveries) x 0.40 x 30
  //   8,000,000 x 0.4 x 30 = 96,000,000
  // The briefing example said 240,000,000 — it omitted the 40%. MUA confirmed
  // the signed scheme is right. A 2.5x lending error rides on this number.
  await inTenant(async (tx) => {
    const rules = await loadProductRules(tx);
    const car = rules.find((p) => p.kind === "asset");
    assert.ok(car, "no asset product seeded");
    assert.equal(car.capMethod, "takehome_factor");
    assert.equal(Number(car.takehomeFactor), 0.4);
    assert.equal(Number(car.takehomeMultiplier), 30);

    const elig = assessEligibility(car, specEmployee);
    assert.equal(elig.maxAmount, 96000000);
  });
});

test("advance: 1x gross, interest-free", async () => {
  await inTenant(async (tx) => {
    const rules = await loadProductRules(tx);
    const adv = rules.find((p) => p.kind === "advance");
    const elig = assessEligibility(adv, specEmployee);
    assert.equal(elig.maxAmount, 10000000);
    assert.equal(elig.interestApplies, false);
  });
});

test("development: 3x gross", async () => {
  await inTenant(async (tx) => {
    const rules = await loadProductRules(tx);
    const dev = rules.find((p) => p.kind === "term");
    const elig = assessEligibility(dev, specEmployee);
    assert.equal(elig.maxAmount, 30000000);
  });
});