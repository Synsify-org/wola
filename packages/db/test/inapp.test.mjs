// In-app notifications: who can see what, links that can't lead off-site, and the events
// that create them. Runs against the real database as the RUNTIME role (wola_app), so the
// tenant rules and grants are the production ones.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { disburseLoan } from "../src/loans.ts";
import {
  notifyUsers, notifyRoles, userIdsForRoles, listNotifications, unreadCount, markNotificationRead, markAllNotificationsRead,
} from "../src/inapp.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
let admin, app, T, T2;
const u = {}; // name -> user id

const inTenant = (tid, fn) => app.begin(async (tx) => { await tx`SELECT set_config('app.tenant_id', ${tid}, true)`; return fn(tx); });
const T1 = (fn) => inTenant(T, fn);

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 3 });
  await admin`DELETE FROM tenants WHERE slug IN ('bell-a','bell-b')`;
  await admin`DELETE FROM users WHERE email LIKE '%@bell.t'`;
  [{ id: T }] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('bell-a','Bell A','active') RETURNING id`;
  [{ id: T2 }] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('bell-b','Bell B','active') RETURNING id`;
  for (const [name, role, tenant] of [["ann", "cfo", T], ["bob", "cfo", T], ["cat", "employee", T], ["dan", "cfo", T2]]) {
    const [x] = await admin`INSERT INTO users (email,name,status,password_hash) VALUES (${name + "@bell.t"},${name},'active','x') RETURNING id`;
    await admin`INSERT INTO memberships (tenant_id,user_id,role) VALUES (${tenant},${x.id},${role})`;
    u[name] = x.id;
  }
});
after(async () => {
  await admin`DELETE FROM tenants WHERE slug IN ('bell-a','bell-b')`;
  await admin`DELETE FROM users WHERE email LIKE '%@bell.t'`;
  await app.end(); await admin.end();
});

test("a notification reaches only the person it is for, newest first, with an unread count", async () => {
  await T1((tx) => notifyUsers(tx, T, [u.ann], { kind: "t.one", title: "First", href: "/loans" }));
  await T1((tx) => notifyUsers(tx, T, [u.ann], { kind: "t.two", title: "Second", body: "More detail", href: "/applications/abc" }));
  await T1((tx) => notifyUsers(tx, T, [u.bob], { kind: "t.bob", title: "Only for Bob" }));

  const ann = await T1((tx) => listNotifications(tx, T, u.ann));
  assert.deepEqual(ann.items.map((n) => n.title), ["Second", "First"]);
  assert.equal(ann.unread, 2);
  assert.equal(ann.items[0].body, "More detail");
  assert.equal(ann.items[0].read, false);

  const bob = await T1((tx) => listNotifications(tx, T, u.bob));
  assert.deepEqual(bob.items.map((n) => n.title), ["Only for Bob"]);
  const cat = await T1((tx) => listNotifications(tx, T, u.cat));
  assert.equal(cat.items.length, 0);
});

test("duplicates and missing people are ignored, and an empty title writes nothing", async () => {
  const before_ = await T1((tx) => unreadCount(tx, T, u.cat));
  const n = await T1((tx) => notifyUsers(tx, T, [u.cat, u.cat, null, undefined], { kind: "t.dup", title: "Once" }));
  assert.equal(n, 1);
  assert.equal(await T1((tx) => unreadCount(tx, T, u.cat)), before_ + 1);
  assert.equal(await T1((tx) => notifyUsers(tx, T, [u.cat], { kind: "t.empty", title: "   " })), 0);
  assert.equal(await T1((tx) => notifyUsers(tx, T, [], { kind: "t.none", title: "Nobody" })), 0);
});

test("only the owner can mark a notification read; marking twice is harmless", async () => {
  const [{ id }] = (await T1((tx) => listNotifications(tx, T, u.ann))).items;
  assert.equal(await T1((tx) => markNotificationRead(tx, { tenantId: T, userId: u.bob, id })), false, "a colleague cannot mark it");
  assert.equal(await T1((tx) => unreadCount(tx, T, u.ann)), 2);
  assert.equal(await T1((tx) => markNotificationRead(tx, { tenantId: T, userId: u.ann, id })), true);
  assert.equal(await T1((tx) => markNotificationRead(tx, { tenantId: T, userId: u.ann, id })), false, "already read");
  assert.equal(await T1((tx) => unreadCount(tx, T, u.ann)), 1);
  assert.equal(await T1((tx) => markAllNotificationsRead(tx, { tenantId: T, userId: u.ann })), 1);
  assert.equal(await T1((tx) => unreadCount(tx, T, u.ann)), 0);
  // Bob's are untouched by Ann marking hers.
  assert.equal(await T1((tx) => unreadCount(tx, T, u.bob)), 1);
});

test("a role broadcast reaches everyone holding it in THIS organisation, minus the person who caused it", async () => {
  assert.deepEqual((await T1((tx) => userIdsForRoles(tx, T, ["cfo"]))).sort(), [u.ann, u.bob].sort());
  const n = await T1((tx) => notifyRoles(tx, T, ["cfo"], { kind: "t.role", title: "For finance" }, { exceptUserId: u.ann }));
  assert.equal(n, 1);
  assert.ok((await T1((tx) => listNotifications(tx, T, u.bob))).items.some((x) => x.title === "For finance"));
  assert.ok(!(await T1((tx) => listNotifications(tx, T, u.ann))).items.some((x) => x.title === "For finance"));
  // Dan is a CFO in the OTHER organisation: not reached.
  assert.equal((await inTenant(T2, (tx) => listNotifications(tx, T2, u.dan))).items.length, 0);
  assert.deepEqual(await T1((tx) => userIdsForRoles(tx, T, [])), []);
});

test("a link must stay inside the app: external and protocol-relative links are dropped", async () => {
  for (const bad of ["https://evil.example/login", "//evil.example", "javascript:alert(1)", "\\\\evil", ""]) {
    await T1((tx) => notifyUsers(tx, T, [u.cat], { kind: "t.href", title: `bad ${bad}`, href: bad }));
  }
  const items = (await T1((tx) => listNotifications(tx, T, u.cat, { limit: 50 }))).items.filter((n) => n.kind === "t.href");
  assert.equal(items.length, 5);
  for (const n of items) assert.equal(n.href, null, `${n.title} must not keep its link`);
  // And the database refuses one that slips past the app.
  await assert.rejects(admin`INSERT INTO notifications (tenant_id,user_id,kind,title,href) VALUES (${T},${u.cat},'x','y','https://evil.example')`, /check constraint|violates/i);
});

test("long text is trimmed, not rejected", async () => {
  await T1((tx) => notifyUsers(tx, T, [u.bob], { kind: "t.long", title: "T".repeat(400), body: "B".repeat(900) }));
  const n = (await T1((tx) => listNotifications(tx, T, u.bob, { limit: 50 }))).items.find((x) => x.kind === "t.long");
  assert.ok(n.title.length <= 160 && n.title.endsWith("…"));
  assert.ok(n.body.length <= 500);
});

test("another organisation can't see these rows, can't write into this one, and nobody can delete", async () => {
  assert.equal((await inTenant(T2, (tx) => tx`SELECT count(*)::int AS n FROM notifications`))[0].n, 0);
  await assert.rejects(
    inTenant(T2, (tx) => tx`INSERT INTO notifications (tenant_id,user_id,kind,title) VALUES (${T},${u.ann},'x','smuggled')`),
    /row-level security|violates/i,
  );
  await assert.rejects(T1((tx) => tx`DELETE FROM notifications`), /permission denied/i);
  // No tenant context at all: nothing.
  assert.equal((await app`SELECT count(*)::int AS n FROM notifications`)[0].n, 0);
});

test("disbursing a loan tells the borrower, with a link to the loan", async () => {
  const [prod] = await admin`INSERT INTO loan_products (tenant_id,name,kind) VALUES (${T},'Dev','term') RETURNING id`;
  const [emp] = await admin`INSERT INTO employees (tenant_id,user_id,employee_no,full_name,gross_salary,net_salary)
    VALUES (${T},${u.cat},'B1','Cat Borrower',5000000,3500000) RETURNING id`;
  const [a] = await admin`INSERT INTO loan_applications (tenant_id,employee_id,loan_product_id,amount,tenor_months,status)
    VALUES (${T},${emp.id},${prod.id},4000000,6,'approved') RETURNING id`;
  const [l] = await admin`INSERT INTO loans (tenant_id,application_id,principal,annual_rate,rate_mode,start_date,tenor_months,status)
    VALUES (${T},${a.id},4000000,0.12,'fixed','2026-01-15',6,'pending_disbursement') RETURNING id`;

  await T1((tx) => disburseLoan(tx, { tenantId: T, loanId: l.id }));
  const mine = (await T1((tx) => listNotifications(tx, T, u.cat, { limit: 50 }))).items.filter((n) => n.kind === "loan.disbursed");
  assert.equal(mine.length, 1);
  assert.equal(mine[0].title, "Your loan was disbursed");
  assert.match(mine[0].body, /UGX 4,000,000/);
  assert.equal(mine[0].href, `/loans/${l.id}`);
  assert.equal((await T1((tx) => listNotifications(tx, T, u.ann, { limit: 50 }))).items.filter((n) => n.kind === "loan.disbursed").length, 0, "a colleague isn't told");
});
