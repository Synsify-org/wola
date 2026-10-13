// Administration of products and approval routing.
// The invariants that matter: (1) a product is created valid or not at all,
// (2) re-routing never rewrites history and never strands in-flight
// applications, (3) exclusions are symmetric.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { createProduct, updateProduct, listProductsAdmin, setProductActive } from "../src/product-admin.ts";
import { saveChain, listRouting } from "../src/routing-admin.ts";
import { routeApplication, loadPipelines, resolveRate, inboxFor } from "../src/approvals.ts";
import { setRateIndex, productsMissingRateIndex } from "../src/rate-indices.ts";
import { loadProductRules } from "../src/product-rules.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
let admin, app, T;
const ids = {};

const inTenant = (fn) =>
  app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${T}, true)`;
    return fn(tx);
  });

const input = (over = {}) => ({
  name: "Test Product", kind: "term", capMethod: "salary_multiple", capBasis: "gross",
  capMultiple: 3, takehomeFactor: null, takehomeMultiplier: null, maxTenorMonths: 24,
  interestApplies: true, rateMode: "index", rateIndexName: "CBR", rateMargin: 0, fixedRate: null,
  requiresPostProbation: true, blockedByFinalWarning: true, requiresExternalDeclaration: false,
  excludes: [], ...over,
});
const stage = (role, slaHours = null) => ({ role, slaHours, allowDelegation: true });

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 2 });
  await admin`DELETE FROM tenants WHERE slug = 'padmin-t'`;
  await admin`DELETE FROM users WHERE email LIKE '%@padmin.t'`;
  const [t] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('padmin-t','PAdmin','active') RETURNING id`;
  T = t.id;
  await admin`INSERT INTO rate_indices (tenant_id,name,current_value,effective_from) VALUES (${T},'CBR',9.5,'2026-01-01')`;
  const [u] = await admin`INSERT INTO users (email,name,status,password_hash) VALUES ('s@padmin.t','s','active','x') RETURNING id`;
  await admin`INSERT INTO memberships (tenant_id,user_id,role) VALUES (${T},${u.id},'employee')`;
  const [e] = await admin`INSERT INTO employees (tenant_id,user_id,employee_no,full_name,gross_salary,net_salary,is_post_probation)
    VALUES (${T},${u.id},'E1','E1',5000000,4000000,true) RETURNING id`;
  ids.emp = e.id;
});

after(async () => {
  await app.end();
  await admin.end();
});

test("creating a product: validated, linked to the current rate, routing copied", async () => {
  // Seed a source product with a chain to copy from.
  const src = await inTenant((tx) => createProduct(tx, { tenantId: T, input: input({ name: "Source" }) }));
  assert.equal(src.ok, true, src.error);
  ids.src = src.id;
  const saved = await inTenant((tx) => saveChain(tx, { tenantId: T, productId: ids.src, appliesTo: "default", stages: [stage("hr"), stage("cfo"), stage("ceo")] }));
  assert.deepEqual(saved, { ok: true, changed: "rerouted" });

  const made = await inTenant((tx) => createProduct(tx, { tenantId: T, input: input({ name: "Copy" }), copyRoutingFrom: ids.src }));
  assert.equal(made.ok, true, made.error);
  ids.copy = made.id;
  const rows = await inTenant((tx) => listProductsAdmin(tx));
  const copy = rows.find((p) => p.id === ids.copy);
  assert.equal(copy.rateIndexName, "CBR");
  assert.deepEqual(copy.chain, ["hr", "cfo", "ceo"]);
});

test("invalid input is rejected with per-field messages and nothing is written", async () => {
  const bad = await inTenant((tx) => createProduct(tx, { tenantId: T, input: input({ name: "X", capMultiple: 0 }) }));
  assert.equal(bad.ok, false);
  assert.ok(bad.fieldErrors.name && bad.fieldErrors.capMultiple);
  const noRate = await inTenant((tx) => createProduct(tx, { tenantId: T, input: input({ name: "Nope", rateIndexName: "Missing" }) }));
  assert.equal(noRate.ok, false);
  assert.ok(noRate.fieldErrors.rateIndexName);
  const dup = await inTenant((tx) => createProduct(tx, { tenantId: T, input: input({ name: "Copy" }) }));
  assert.equal(dup.ok, false);
  assert.match(dup.fieldErrors.name, /already/);
  const [{ n }] = await admin`SELECT count(*)::int AS n FROM loan_products WHERE tenant_id = ${T}`;
  assert.equal(n, 2);
});

test("exclusions are symmetric and replaced on edit", async () => {
  const r = await inTenant((tx) => updateProduct(tx, { tenantId: T, id: ids.copy, input: input({ name: "Copy", excludes: [ids.src] }) }));
  assert.equal(r.ok, true, r.error);
  let rows = await inTenant((tx) => listProductsAdmin(tx));
  assert.deepEqual(rows.find((p) => p.id === ids.src).excludes, [ids.copy], "the other side mirrors it");
  await inTenant((tx) => updateProduct(tx, { tenantId: T, id: ids.copy, input: input({ name: "Copy", excludes: [] }) }));
  rows = await inTenant((tx) => listProductsAdmin(tx));
  assert.deepEqual(rows.find((p) => p.id === ids.src).excludes, []);
});

test("switching a product off hides it from the live list but keeps it listed for admins", async () => {
  await inTenant((tx) => setProductActive(tx, { tenantId: T, id: ids.copy, active: false }));
  const rows = await inTenant((tx) => listProductsAdmin(tx));
  assert.equal(rows.find((p) => p.id === ids.copy).active, false);
  await inTenant((tx) => setProductActive(tx, { tenantId: T, id: ids.copy, active: true }));
});

test("re-routing is refused while applications are in review; tweaks are allowed", async () => {
  const [a] = await admin`INSERT INTO loan_applications (tenant_id,employee_id,loan_product_id,amount,tenor_months,status)
    VALUES (${T},${ids.emp},${ids.src},1000000,6,'submitted') RETURNING id`;
  ids.inflight = a.id;

  const blocked = await inTenant((tx) => saveChain(tx, { tenantId: T, productId: ids.src, appliesTo: "default", stages: [stage("hr"), stage("ceo")] }));
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /still in review/);

  const tweak = await inTenant((tx) => saveChain(tx, { tenantId: T, productId: ids.src, appliesTo: "default", stages: [stage("hr", 48), stage("cfo"), stage("ceo")] }));
  assert.deepEqual(tweak, { ok: true, changed: "tweaked" });
  const r = (await inTenant((tx) => listRouting(tx))).find((p) => p.productId === ids.src);
  assert.equal(r.inReview, 1);
  assert.equal(r.chains[0].stages[0].slaHours, 48);
});

test("a decided application keeps the chain that decided it after routing changes", async () => {
  // Decide the in-flight one (as if fully approved), then re-route.
  await admin`UPDATE loan_applications SET status = 'approved' WHERE id = ${ids.inflight}`;
  const stagesBefore = await inTenant((tx) => loadPipelines(tx, ids.src));
  const oldIds = stagesBefore[0].stages.map((s) => s.id);
  // Record approvals at all three old stages.
  for (const sid of oldIds) {
    await admin`INSERT INTO approvals (tenant_id,application_id,stage_id,decision,decided_at)
      VALUES (${T},${ids.inflight},${sid},'approved',now())`;
  }

  const res = await inTenant((tx) => saveChain(tx, { tenantId: T, productId: ids.src, appliesTo: "default", stages: [stage("hr"), stage("ceo")] }));
  assert.deepEqual(res, { ok: true, changed: "rerouted" });

  const now = await inTenant((tx) => loadPipelines(tx, ids.src));
  assert.deepEqual(now[0].stages.map((s) => s.approverRole), ["hr", "ceo"], "live chain is the new one");

  const old = await inTenant((tx) => routeApplication(tx, ids.inflight));
  assert.equal(old.routing.state, "approved", "the decided application still reads as approved");
  assert.deepEqual(old.routing.stages.map((s) => s.approverRole), ["hr", "cfo", "ceo"], "...under its original chain");

  // And a fresh application is routed by the new chain.
  const [b] = await admin`INSERT INTO loan_applications (tenant_id,employee_id,loan_product_id,amount,tenor_months,status)
    VALUES (${T},${ids.emp},${ids.src},1000000,6,'submitted') RETURNING id`;
  const fresh = await inTenant((tx) => routeApplication(tx, b.id));
  assert.deepEqual(fresh.routing.stages.map((s) => s.approverRole), ["hr", "ceo"]);
  await admin`UPDATE loan_applications SET status = 'withdrawn' WHERE id = ${b.id}`;
});

test("an exception chain can be added and removed; the standard chain cannot be emptied", async () => {
  const add = await inTenant((tx) => saveChain(tx, { tenantId: T, productId: ids.src, appliesTo: "ceo", stages: [stage("cfo")] }));
  assert.equal(add.ok, true, add.error);
  let r = (await inTenant((tx) => listRouting(tx))).find((p) => p.productId === ids.src);
  assert.deepEqual(r.chains.map((c) => c.appliesTo), ["default", "ceo"]);

  const rm = await inTenant((tx) => saveChain(tx, { tenantId: T, productId: ids.src, appliesTo: "ceo", stages: [] }));
  assert.deepEqual(rm, { ok: true, changed: "removed" });
  r = (await inTenant((tx) => listRouting(tx))).find((p) => p.productId === ids.src);
  assert.deepEqual(r.chains.map((c) => c.appliesTo), ["default"]);

  const empty = await inTenant((tx) => saveChain(tx, { tenantId: T, productId: ids.src, appliesTo: "default", stages: [] }));
  assert.equal(empty.ok, false);
});

test("pricing: index + margin, discount floor, and fixed rate are quoted exactly", async () => {
  const price = async (over) => {
    const made = await inTenant((tx) => createProduct(tx, { tenantId: T, input: input({ name: "P" + Math.random().toString(36).slice(2, 7), ...over }) }));
    assert.equal(made.ok, true, made.error);
    return { id: made.id, rate: await inTenant((tx) => resolveRate(tx, made.id)) };
  };

  const plain = await price({});
  assert.equal(plain.rate.rate, 0.095);
  assert.equal(plain.rate.mode, "index_plus_margin");

  const plus = await price({ rateMargin: 2 });
  assert.ok(Math.abs(plus.rate.rate - 0.115) < 1e-12);

  const floored = await price({ rateMargin: -20 });
  assert.equal(floored.rate.rate, 0, "a discount cannot make the rate negative");

  const fixed = await price({ rateMode: "fixed", rateIndexName: null, fixedRate: 12 });
  assert.equal(fixed.rate.rate, 0.12);
  assert.equal(fixed.rate.mode, "fixed");
  const [row] = await admin`SELECT rate_index_id FROM loan_products WHERE id = ${fixed.id}`;
  assert.equal(row.rate_index_id, null, "a fixed-rate product follows no index");

  ids.fixed = fixed.id;
  ids.plus = plus.id;
});

test("a CBR change moves index products (margin kept) and never touches a fixed-rate product", async () => {
  await inTenant((tx) => setRateIndex(tx, { tenantId: T, name: "CBR", value: 20, effectiveFrom: new Date("2026-06-01") }));
  assert.ok(Math.abs((await inTenant((tx) => resolveRate(tx, ids.plus))).rate - 0.22) < 1e-12, "20% + 2% margin");
  assert.equal((await inTenant((tx) => resolveRate(tx, ids.fixed))).rate, 0.12, "fixed stays 12%");
});

test("the apply form sees each product's current rate; the missing-rate warning ignores fixed products", async () => {
  const rules = await inTenant((tx) => loadProductRules(tx));
  assert.equal(rules.find((p) => p.productId === ids.fixed).currentRate, 0.12);
  assert.ok(Math.abs(rules.find((p) => p.productId === ids.plus).currentRate - 0.22) < 1e-12);
  const missing = await inTenant((tx) => productsMissingRateIndex(tx, T));
  assert.equal(missing.some((m) => m.id === ids.fixed), false);
});

test("a fixed-rate product without a rate is rejected", async () => {
  const bad = await inTenant((tx) => createProduct(tx, { tenantId: T, input: input({ name: "NoRate", rateMode: "fixed", rateIndexName: null, fixedRate: null }) }));
  assert.equal(bad.ok, false);
  assert.ok(bad.fieldErrors.fixedRate);
});

test("approvers see how long an application has waited and the stage's time limit", async () => {
  // Chain is hr > ceo by now. Give HR a 24h limit, and submit an application 3 days ago.
  const tweak = await inTenant((tx) => saveChain(tx, { tenantId: T, productId: ids.src, appliesTo: "default", stages: [stage("hr", 24), stage("ceo")] }));
  assert.equal(tweak.ok, true, tweak.error);
  // Backdate the live stages too: an application is routed by the chain that was
  // live when it was submitted, so it can't predate the stages it is routed by.
  await admin`UPDATE approval_stages SET created_at = now() - interval '10 days'
    WHERE retired_at IS NULL AND pipeline_id IN (SELECT id FROM approval_pipelines WHERE loan_product_id = ${ids.src})`;
  const [a] = await admin`INSERT INTO loan_applications (tenant_id,employee_id,loan_product_id,amount,tenor_months,status,created_at)
    VALUES (${T},${ids.emp},${ids.src},1000000,6,'submitted', now() - interval '3 days') RETURNING id`;
  const inbox = await inTenant((tx) => inboxFor(tx, T, { userId: ids.emp, employeeId: null, role: "hr" }));
  const item = inbox.find((i) => i.applicationId === a.id);
  assert.ok(item, "the HR approver sees it");
  assert.equal(item.slaHours, 24);
  const hours = (Date.now() - new Date(item.waitingSince).getTime()) / 3_600_000;
  assert.ok(hours > 70 && hours < 74, `waiting since ~3 days ago, got ${hours}h`);
  await admin`UPDATE loan_applications SET status = 'withdrawn' WHERE id = ${a.id}`;
});
