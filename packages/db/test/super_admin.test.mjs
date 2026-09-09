// packages/db/test/super_admin.test.mjs
// Proves the super-admin identity check and the cross-tenant aggregation
// functions against a real database. The aggregation functions are
// deliberately GLOBAL (every tenant in the database, not one) — unlike every
// other test file here, which asserts ISOLATION, these assert the opposite:
// that data from multiple tenants is correctly combined. Because node:test
// runs files concurrently and other files' fixture tenants live in the SAME
// database, exact global totals would be flaky; assertions below either
// scope to a specific tenant/row found by id, or check a DELTA around a
// known change rather than an absolute count.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import argon2 from "argon2";
import {
  authenticateSuperAdmin, platformOverview, tenantRegistry, crossTenantAuditLog,
} from "../src/super-admin.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
let admin, app, A, B;
const ids = {};

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 2 });

  for (const t of ["audit_log", "loans", "loan_applications", "loan_products", "employees"])
    await admin.unsafe(`DELETE FROM ${t} WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('sa-a','sa-b'))`);
  await admin`DELETE FROM tenants WHERE slug IN ('sa-a','sa-b')`;
  await admin`DELETE FROM super_admins WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@sa.t')`;
  await admin`DELETE FROM super_admin_sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@sa.t')`;
  await admin`DELETE FROM login_attempts WHERE email LIKE '%@sa.t'`;
  await admin`DELETE FROM users WHERE email LIKE '%@sa.t'`;

  const [a] = await admin`INSERT INTO tenants (slug,name,status,plan) VALUES ('sa-a','SA Tenant A','active','standard') RETURNING id`;
  const [b] = await admin`INSERT INTO tenants (slug,name,status,plan) VALUES ('sa-b','SA Tenant B','active','standard') RETURNING id`;
  A = a.id; B = b.id;

  const seedLoan = async (tenantId, principal) => {
    const [emp] = await admin`INSERT INTO employees (tenant_id,employee_no,full_name,gross_salary,net_salary)
      VALUES (${tenantId},'E1','Emp',5000000,4000000) RETURNING id`;
    const [prod] = await admin`INSERT INTO loan_products (tenant_id,name,kind) VALUES (${tenantId},'Adv','term') RETURNING id`;
    const [appn] = await admin`INSERT INTO loan_applications (tenant_id,employee_id,loan_product_id,amount,tenor_months,status)
      VALUES (${tenantId},${emp.id},${prod.id},${principal},12,'approved') RETURNING id`;
    await admin`INSERT INTO loans (tenant_id,application_id,principal,annual_rate,rate_mode,start_date,tenor_months,status)
      VALUES (${tenantId},${appn.id},${principal},0.16,'fixed','2026-01-01',12,'active')`;
  };
  await seedLoan(A, 1_000_000);
  await seedLoan(B, 2_000_000);

  await admin`INSERT INTO audit_log (tenant_id,action,entity) VALUES (${A},'sa_test.marker_a','widget')`;
  await admin`INSERT INTO audit_log (tenant_id,action,entity) VALUES (${B},'sa_test.marker_b','widget')`;

  const hash = await argon2.hash("super-secret-123", { type: argon2.argon2id });
  const [user] = await admin`INSERT INTO users (email,name,status,password_hash)
    VALUES ('op@sa.t','Operator','active',${hash}) RETURNING id`;
  ids.userId = user.id;
  await admin`INSERT INTO super_admins (user_id,status) VALUES (${user.id},'active')`;

  const disabledHash = await argon2.hash("also-secret-123", { type: argon2.argon2id });
  const [disabledUser] = await admin`INSERT INTO users (email,name,status,password_hash)
    VALUES ('disabled@sa.t','Disabled Op','active',${disabledHash}) RETURNING id`;
  await admin`INSERT INTO super_admins (user_id,status) VALUES (${disabledUser.id},'disabled')`;
});

after(async () => { await app.end(); await admin.end(); });

test("valid credentials for an ACTIVE super-admin succeed", async () => {
  const r = await authenticateSuperAdmin(app, "op@sa.t", "super-secret-123", "1.1.1.1");
  assert.equal(r.ok, true);
  assert.equal(r.userId, ids.userId);
});

test("wrong password is rejected", async () => {
  const r = await authenticateSuperAdmin(app, "op@sa.t", "wrong-password", "1.1.1.2");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "invalid");
});

test("a tenant user who is NOT a super-admin cannot authenticate here, even with the right password", async () => {
  const hash = await argon2.hash("tenant-user-pw-123", { type: argon2.argon2id });
  await admin`INSERT INTO users (email,name,status,password_hash) VALUES ('notadmin@sa.t','Not Admin','active',${hash})`;
  const r = await authenticateSuperAdmin(app, "notadmin@sa.t", "tenant-user-pw-123", "1.1.1.3");
  assert.equal(r.ok, false);
});

test("a DISABLED super-admin is rejected even with the correct password", async () => {
  const r = await authenticateSuperAdmin(app, "disabled@sa.t", "also-secret-123", "1.1.1.4");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "invalid");
});

test("the 6th login attempt within the window is rate-limited", async () => {
  for (let i = 0; i < 5; i++) {
    await authenticateSuperAdmin(app, "op@sa.t", "wrong-again", "9.9.9.9");
  }
  const sixth = await authenticateSuperAdmin(app, "op@sa.t", "super-secret-123", "9.9.9.9");
  assert.equal(sixth.ok, false);
  assert.equal(sixth.reason, "rate_limited");
});

test("tenantRegistry lists both seeded tenants with their correct active-loan totals", async () => {
  const rows = await tenantRegistry(app);
  const a = rows.find((r) => r.id === A);
  const b = rows.find((r) => r.id === B);
  assert.ok(a, "tenant A must appear in the registry");
  assert.ok(b, "tenant B must appear in the registry");
  assert.equal(a.activeLoans, 1);
  assert.equal(a.principalDisbursed, 1_000_000);
  assert.equal(b.activeLoans, 1);
  assert.equal(b.principalDisbursed, 2_000_000);
});

test("platformOverview's totals move by exactly what a new active loan adds", async () => {
  const before = await platformOverview(app);

  const [emp] = await admin`INSERT INTO employees (tenant_id,employee_no,full_name,gross_salary,net_salary)
    VALUES (${A},'E2','Emp2',5000000,4000000) RETURNING id`;
  const [prod] = await admin`INSERT INTO loan_products (tenant_id,name,kind) VALUES (${A},'Adv2','term') RETURNING id`;
  const [appn] = await admin`INSERT INTO loan_applications (tenant_id,employee_id,loan_product_id,amount,tenor_months,status)
    VALUES (${A},${emp.id},${prod.id},500000,12,'approved') RETURNING id`;
  await admin`INSERT INTO loans (tenant_id,application_id,principal,annual_rate,rate_mode,start_date,tenor_months,status)
    VALUES (${A},${appn.id},500000,0.16,'fixed','2026-01-01',12,'active')`;

  const after = await platformOverview(app);
  assert.equal(after.totalActiveLoans - before.totalActiveLoans, 1);
  assert.equal(after.totalPrincipalDisbursed - before.totalPrincipalDisbursed, 500000);
  assert.equal(after.totalOutstanding - before.totalOutstanding, 500000);
});

test("crossTenantAuditLog surfaces rows from BOTH tenants, correctly tagged by tenant name", async () => {
  const rows = await crossTenantAuditLog(app, 50, 500);
  const a = rows.find((r) => r.action === "sa_test.marker_a");
  const b = rows.find((r) => r.action === "sa_test.marker_b");
  assert.ok(a, "tenant A's audit row must appear");
  assert.ok(b, "tenant B's audit row must appear");
  assert.equal(a.tenantName, "SA Tenant A");
  assert.equal(b.tenantName, "SA Tenant B");
});
