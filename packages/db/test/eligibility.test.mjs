// packages/db/test/eligibility.test.mjs
// Pins MUA's benefit scheme AS SEEDED. The engine tests prove the engine is
// correct for any config; nothing else proves MUA's config is correct.
// Migration 0008 moved the lending rules out of code and into data — out from
// under the test suite. This file buys that safety back.
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
  // Reads the DEV SEED (testco) — the same rows an admin would configure.
  const [t] = await admin`SELECT id FROM tenants WHERE slug = 'testco'`;
  assert.ok(t, "seed-dev.sql has not been run: no 'testco' tenant");
  T = t.id;
});

after(async () => {
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

test("car loan: the seeded config yields the CONFIRMED 96m cap", async () => {
  // Confirmed with MUA HR, 2026-07-14:  (net - recoveries) x 0.40 x 30
  //   8,000,000 x 0.4 x 30 = 96,000,000
  // The briefing example said 240,000,000 — it omitted the 40%. MUA confirmed
  // the signed scheme is right. THIS ASSERTION IS THE ONLY THING BETWEEN A
  // SEED EDIT AND A 2.5x LENDING ERROR. Do not delete it. Do not relax it.
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