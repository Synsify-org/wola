// The SQL that creates a client organisation (npm run tenant:sql) is run here against a real
// database, so what the client's administrator will get in production is what is tested.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { createHash } from "node:crypto";
import { tenantSql, validate } from "../../../scripts/lib/tenant-sql.mjs";

const ADMIN = process.env.DATABASE_ADMIN_URL;
let admin;
const SLUG = "tsql-mua";
const input = { slug: SLUG, name: "MUA <Insurance> Uganda", adminEmail: "Ada.Admin@mua.test", adminName: "Ada O'Neil", origin: "https://mua.example.com", template: "benefit-scheme", token: "a".repeat(64) };

const wipe = async () => { await admin`DELETE FROM email_outbox WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = ${SLUG})`; await admin`DELETE FROM tenants WHERE slug = ${SLUG}`; };
before(async () => { admin = postgres(ADMIN, { max: 1 }); await wipe(); });
after(async () => { await wipe(); await admin.end(); });

test("the benefit-scheme template creates the organisation, three products, the rules and every approval chain", async () => {
  const { sql } = tenantSql(input);
  const res = await admin.unsafe(sql);
  const summary = res[res.length - 1][0];
  assert.deepEqual({ ...summary }, { slug: SLUG, name: "MUA <Insurance> Uganda", status: "active", products: "3", approval_stages: "23", invitations: "1", emails_queued: "1" });

  const products = await admin`SELECT p.name, p.kind, p.cap_method, p.cap_multiple::float AS cap_multiple, p.takehome_factor::float AS factor, p.max_tenor_months, p.interest_applies, p.requires_post_probation, p.blocked_by_final_warning, p.requires_external_declaration
    FROM loan_products p JOIN tenants t ON t.id = p.tenant_id WHERE t.slug = ${SLUG} ORDER BY p.name`;
  assert.deepEqual(products.map((p) => p.name), ["Development Loan", "Salary Advance", "Staff Car Loan"]);
  const adv = products.find((p) => p.kind === "advance"), dev = products.find((p) => p.kind === "term"), car = products.find((p) => p.kind === "asset");
  assert.deepEqual([adv.cap_multiple, adv.max_tenor_months, adv.interest_applies, adv.requires_external_declaration], [1, 3, false, false]);
  assert.deepEqual([dev.cap_multiple, dev.max_tenor_months, dev.interest_applies, dev.requires_external_declaration], [3, 36, true, true]);
  assert.deepEqual([car.cap_method, car.factor, car.max_tenor_months], ["takehome_factor", 0.4, 36]);
  for (const p of products) assert.ok(p.requires_post_probation && p.blocked_by_final_warning);

  const chains = await admin`SELECT lp.kind, p.applies_to, string_agg(s.approver_role, '>' ORDER BY s.position) AS chain
    FROM approval_pipelines p JOIN loan_products lp ON lp.id = p.loan_product_id JOIN approval_stages s ON s.pipeline_id = p.id
    JOIN tenants t ON t.id = p.tenant_id WHERE t.slug = ${SLUG} GROUP BY lp.kind, p.applies_to ORDER BY 1, 2`;
  const chain = (kind, who) => chains.find((c) => c.kind === kind && c.applies_to === who).chain;
  for (const k of ["advance", "term", "asset"]) assert.equal(chain(k, "default"), "dept_head>hr>cfo>ceo");
  assert.equal(chain("advance", "ceo"), "hr>cfo>coo");
  assert.equal(chain("term", "ceo"), "hr>cfo>coo>group_ceo");
  assert.equal(chain("asset", "ceo"), "hr>cfo>coo>group_ceo");

  const excl = await admin`SELECT count(*)::int AS n FROM product_exclusions e JOIN tenants t ON t.id = e.tenant_id WHERE t.slug = ${SLUG}`;
  assert.equal(excl[0].n, 2, "car and development are mutually exclusive, both ways");
});

test("the administrator gets an invitation only a person holding the link can use, and no password exists", async () => {
  const [inv] = await admin`SELECT i.email, i.role, i.token_hash, i.accepted_at, i.expires_at > now() + interval '6 days' AS long_lived FROM invitations i JOIN tenants t ON t.id = i.tenant_id WHERE t.slug = ${SLUG}`;
  assert.equal(inv.email, "ada.admin@mua.test");
  assert.equal(inv.role, "org_admin");
  assert.equal(inv.token_hash, createHash("sha256").update("a".repeat(64)).digest("hex"), "only the hash is stored");
  assert.equal(inv.accepted_at, null); assert.ok(inv.long_lived);
  assert.equal((await admin`SELECT 1 FROM users WHERE email = 'ada.admin@mua.test'`).length, 0, "no account or password was created");

  const [mail] = await admin`SELECT subject, body_html FROM email_outbox o JOIN tenants t ON t.id = o.tenant_id WHERE t.slug = ${SLUG}`;
  assert.match(mail.body_html, /https:\/\/mua\.example\.com\/accept-invite\?token=a{64}/);
  assert.match(mail.body_html, /MUA &lt;Insurance&gt; Uganda/, "names are escaped in the email");
  assert.match(mail.body_html, /Ada O&#39;Neil/);
});

test("running it again changes nothing and says why", async () => {
  await assert.rejects(admin.unsafe(tenantSql({ ...input, token: "b".repeat(64) }).sql), /already exists\. Nothing was changed/);
  assert.equal((await admin`SELECT count(*)::int AS n FROM tenants WHERE slug = ${SLUG}`)[0].n, 1);
  assert.equal((await admin`SELECT count(*)::int AS n FROM invitations i JOIN tenants t ON t.id = i.tenant_id WHERE t.slug = ${SLUG}`)[0].n, 1);
});

test("the blank template creates only the organisation and its administrator's invitation", async () => {
  await wipe();
  const res = await admin.unsafe(tenantSql({ ...input, template: "blank" }).sql);
  const s = res[res.length - 1][0];
  assert.equal(s.products, "0"); assert.equal(s.approval_stages, "0"); assert.equal(s.invitations, "1");
});

test("bad answers are refused before any SQL exists", () => {
  assert.ok(validate({ ...input, slug: "Bad Slug" }).length);
  assert.ok(validate({ ...input, slug: "admin" }).some((e) => /reserved/.test(e)));
  assert.ok(validate({ ...input, adminEmail: "nope" }).length);
  assert.ok(validate({ ...input, origin: "mua.example.com" }).length);
  assert.ok(validate({ ...input, origin: "https://mua.example.com/app" }).length);
  assert.ok(validate({ ...input, template: "magic" }).length);
  assert.deepEqual(validate(input), []);
  assert.throws(() => tenantSql({ ...input, slug: "x" }), /short name/);
});

test("--trial flags the organisation as a trial in its settings; a normal organisation is not flagged", async () => {
  await wipe();
  await admin.unsafe(tenantSql({ ...input, trial: true }).sql);
  const [t] = await admin`SELECT settings FROM tenants WHERE slug = ${SLUG}`;
  assert.equal(t.settings.trial, true);
  await wipe();
  await admin.unsafe(tenantSql({ ...input }).sql);
  const [n] = await admin`SELECT settings FROM tenants WHERE slug = ${SLUG}`;
  assert.equal(n.settings.trial, undefined, "no flag unless asked for");
});
