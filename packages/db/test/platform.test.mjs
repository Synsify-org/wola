// The platform console's data: per-organisation summaries, what needs attention, the
// operator list, one organisation in full, and the operators' own audit trail. Runs as the
// RUNTIME role, like the app, so the grants and tenant rules are the production ones.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { platformConsole, orgDetail, recordPlatformEvent, listPlatformEvents } from "../src/platform.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
let admin, app, A, B, op;

const clean = async () => {
  await admin`DELETE FROM platform_audit_log WHERE actor_email LIKE '%@plat.t'`;
  // audit_log has no cascade (it is append-only history); the admin role clears it for fixtures.
  await admin`DELETE FROM audit_log WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('plat-a','plat-b'))`;
  await admin`DELETE FROM tenants WHERE slug IN ('plat-a','plat-b')`;
  await admin`DELETE FROM users WHERE email LIKE '%@plat.t'`;
};

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 3 });
  await clean();
  [{ id: A }] = await admin`INSERT INTO tenants (slug,name,status,currency) VALUES ('plat-a','Plat A','active','UGX') RETURNING id`;
  const settingsB = { security: { mfaRequiredRoles: ["cfo", "org_admin"] }, loanExit: { policy: "manual" } };
  [{ id: B }] = await admin`INSERT INTO tenants (slug,name,status,currency,settings) VALUES ('plat-b','Plat B','suspended','UGX', ${admin.json(settingsB)}) RETURNING id`;

  const user = async (email, tenant, role) => {
    const [u] = await admin`INSERT INTO users (email,name,status,password_hash) VALUES (${email},${email.split("@")[0]},'active','x') RETURNING id`;
    if (tenant) await admin`INSERT INTO memberships (tenant_id,user_id,role) VALUES (${tenant},${u.id},${role})`;
    return u.id;
  };
  const cfoA = await user("cfo@plat.t", A, "cfo");
  await user("emp@plat.t", A, "employee");
  await user("admin@plat.t", B, "org_admin");
  op = await user("op@plat.t", null, null);
  await admin`INSERT INTO super_admins (user_id,status) VALUES (${op},'active')`;
  await admin`INSERT INTO user_mfa (user_id, secret_enc, enabled_at) VALUES (${op}, 'x', now())`;

  // Organisation A: one employee, one active loan of 5,000,000, one failed and one pending email.
  const [e] = await admin`INSERT INTO employees (tenant_id,user_id,employee_no,full_name,gross_salary,net_salary) VALUES (${A},${cfoA},'P1','Cfo A',5000000,3500000) RETURNING id`;
  const [prod] = await admin`INSERT INTO loan_products (tenant_id,name,kind) VALUES (${A},'Dev','term') RETURNING id`;
  const [a] = await admin`INSERT INTO loan_applications (tenant_id,employee_id,loan_product_id,amount,tenor_months,status) VALUES (${A},${e.id},${prod.id},5000000,6,'approved') RETURNING id`;
  await admin`INSERT INTO loans (tenant_id,application_id,principal,annual_rate,rate_mode,start_date,tenor_months,status) VALUES (${A},${a.id},5000000,0.12,'fixed','2026-01-15',6,'active')`;
  await admin`INSERT INTO email_outbox (tenant_id,to_email,subject,body_html,status) VALUES (${A},'x@plat.t','s','b','failed'), (${A},'y@plat.t','s','b','pending')`;
  await admin`INSERT INTO audit_log (tenant_id,actor_id,action,entity) VALUES (${A},${cfoA},'test.action','thing')`;
});
after(async () => {
  try { await clean(); } finally { await app.end(); await admin.end(); }
});

test("each organisation is summarised from its own data", async () => {
  const c = await platformConsole(app);
  const a = c.orgs.find((o) => o.slug === "plat-a");
  assert.equal(a.people, 2);
  assert.equal(a.employees, 1);
  assert.equal(a.activeLoans, 1);
  assert.equal(a.principal, 5_000_000);
  assert.equal(a.outstanding, 5_000_000);
  assert.equal(a.emailsFailed, 1);
  assert.equal(a.emailsPending, 1);
  assert.equal(a.admins, 0);
  assert.ok(a.lastActivityAt, "last activity comes from the organisation's audit log");

  const b = c.orgs.find((o) => o.slug === "plat-b");
  assert.equal(b.status, "suspended");
  assert.equal(b.admins, 1);
  assert.equal(b.mfaRoles, 2);
  assert.equal(b.activeLoans, 0, "B sees none of A's loans");
  assert.ok(c.totals.orgs >= 2 && c.totals.activeLoans >= 1);
  assert.ok(c.money.find((m) => m.currency === "UGX").principal >= 5_000_000);
});

test("what needs attention is spelled out per organisation, warnings first", async () => {
  const c = await platformConsole(app);
  const forA = c.attention.filter((x) => x.tenantName === "Plat A").map((x) => x.text);
  assert.ok(forA.some((t) => /administrator/i.test(t)), "A has no administrator");
  assert.ok(forA.some((t) => /1 email could not be sent/.test(t)));
  assert.ok(forA.some((t) => /1 email is waiting/.test(t)));
  const forB = c.attention.filter((x) => x.tenantName === "Plat B").map((x) => x.text);
  assert.ok(forB.some((t) => /suspended/.test(t)));
  const firstInfo = c.attention.findIndex((x) => x.severity === "info");
  const lastWarn = c.attention.map((x) => x.severity).lastIndexOf("warn");
  assert.ok(firstInfo === -1 || lastWarn < firstInfo, "warnings come before information");
});

test("emails waiting for hours are a warning, with how long; a recent queue is only information", async () => {
  await admin`UPDATE email_outbox SET created_at = now() - interval '3 hours 5 minutes' WHERE tenant_id = ${A} AND status = 'pending'`;
  await admin`INSERT INTO email_outbox (tenant_id,to_email,subject,body_html,status,sent_at) VALUES (${A},'z@plat.t','s','b','sent', now() - interval '1 day')`;
  const c = await platformConsole(app);
  const a = c.orgs.find((o) => o.slug === "plat-a");
  assert.equal(a.emailsSent7d, 1);
  assert.ok(a.oldestPendingAt);
  const stale = c.attention.find((x) => x.tenantName === "Plat A" && /waiting to be sent/.test(x.text));
  assert.equal(stale.severity, "warn");
  assert.match(stale.text, /oldest for 3 hours.*nothing is sending them/);
  assert.ok(c.health.emailsSent7d >= 1 && c.health.oldestPendingAt);
  await admin`UPDATE email_outbox SET created_at = now() WHERE tenant_id = ${A} AND status = 'pending'`;
  const fresh = (await platformConsole(app)).attention.find((x) => x.tenantName === "Plat A" && /waiting to be sent/.test(x.text));
  assert.equal(fresh.severity, "info");
});

test("operators are listed with whether their second step is on", async () => {
  const c = await platformConsole(app);
  const me = c.operators.find((o) => o.email === "op@plat.t");
  assert.equal(me.mfaEnrolled, true);
  assert.equal(me.status, "active");
});

test("one organisation in full: people, roles, book, settings and recent activity", async () => {
  const d = await orgDetail(app, A);
  assert.equal(d.org.name, "Plat A");
  assert.deepEqual(d.roles.map((r) => r.role).sort(), ["cfo", "employee"]);
  assert.equal(d.people.length, 2);
  assert.deepEqual(d.loansByStatus, [{ status: "active", n: 1, principal: 5_000_000 }]);
  assert.equal(d.recent[0].action, "test.action");
  assert.equal(d.loanExitPolicy, "recover_balance");
  const b = await orgDetail(app, B);
  assert.deepEqual(b.mfaRequiredRoles, ["cfo", "org_admin"]);
  assert.equal(b.loanExitPolicy, "manual");
  assert.equal(await orgDetail(app, "not-a-uuid"), null);
  assert.equal(await orgDetail(app, "00000000-0000-0000-0000-000000000000"), null);
});

test("operator activity is recorded and listed, newest first, optionally per organisation", async () => {
  await recordPlatformEvent(app, { actorId: op, action: "platform.signed_in", ip: "10.0.0.1" });
  await recordPlatformEvent(app, { actorId: op, action: "platform.viewed_tenant", tenantId: A, detail: { via: "console" } });
  const all = (await listPlatformEvents(app, { limit: 10 })).filter((e) => e.actorEmail === "op@plat.t");
  assert.deepEqual(all.map((e) => e.action), ["platform.viewed_tenant", "platform.signed_in"]);
  assert.equal(all[0].tenantName, "Plat A");
  assert.deepEqual(all[0].detail, { via: "console" });
  const forA = await listPlatformEvents(app, { tenantId: A });
  assert.ok(forA.every((e) => e.tenantName === "Plat A"));
  const view = await orgDetail(app, A);
  assert.equal(view.operatorViews[0].action, "platform.viewed_tenant", "an organisation's page shows who looked at it");
});

test("the operator trail is append-only for the runtime role, and recording never throws", async () => {
  await assert.rejects(app`DELETE FROM platform_audit_log`, /permission denied/i);
  await assert.rejects(app`UPDATE platform_audit_log SET action = 'x'`, /permission denied/i);
  // An invalid event (blank action) is swallowed and logged, not thrown into the operator's page.
  await recordPlatformEvent(app, { actorId: op, action: "   " });
});
