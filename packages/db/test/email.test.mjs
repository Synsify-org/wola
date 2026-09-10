import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { sendEmail, renderTemplate, deliverPendingEmails } from "../src/email.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
let admin, app, A, B;

const inTenant = (tid, fn) =>
  app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tid}, true)`;
    return fn(tx);
  });

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 2 });
  await admin`DELETE FROM email_outbox WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('eml-a','eml-b'))`;
  await admin`DELETE FROM tenants WHERE slug IN ('eml-a','eml-b')`;

  [A] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('eml-a','Eml A','active') RETURNING id`;
  [B] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('eml-b','Eml B','active') RETURNING id`;
});
after(async () => { await app.end(); await admin.end(); });

test("template substitution renders {{var}} and leaves missing vars empty, never literal", () => {
  const out = renderTemplate("Hi {{name}}, your code is {{code}} and {{missing}}.", { name: "Grace", code: 42 });
  assert.equal(out, "Hi Grace, your code is 42 and .");
});

test("enqueuing writes an email_outbox row with status pending", async () => {
  const { id } = await inTenant(A.id, (tx) =>
    sendEmail(tx, {
      tenantId: A.id,
      to: "grace@example.com",
      template: { subject: "Welcome {{name}}", html: "<p>Hi {{name}}</p>" },
      data: { name: "Grace" },
    }));

  const [row] = await inTenant(A.id, (tx) => tx`SELECT * FROM email_outbox WHERE id = ${id}`);
  assert.equal(row.status, "pending");
  assert.equal(row.subject, "Welcome Grace");
  assert.equal(row.body_html, "<p>Hi Grace</p>");
  assert.equal(row.attempts, 0);
});

test("an email row is scoped to its tenant and RLS-isolated from another tenant", async () => {
  const { id } = await inTenant(A.id, (tx) =>
    sendEmail(tx, { tenantId: A.id, to: "isolated@example.com", template: { subject: "S", html: "H" } }));

  const seenByB = await inTenant(B.id, (tx) => tx`SELECT * FROM email_outbox WHERE id = ${id}`);
  assert.equal(seenByB.length, 0);

  const seenByA = await inTenant(A.id, (tx) => tx`SELECT * FROM email_outbox WHERE id = ${id}`);
  assert.equal(seenByA.length, 1);
});

test("a successful send flips status to sent and sets sent_at", async () => {
  await inTenant(A.id, (tx) =>
    sendEmail(tx, { tenantId: A.id, to: "ok@example.com", template: { subject: "OK", html: "H" } }));

  const okMailer = { async send() {} };
  await deliverPendingEmails(admin, okMailer, 100);

  const [row] = await admin`SELECT * FROM email_outbox WHERE tenant_id = ${A.id} AND to_email = 'ok@example.com'`;
  assert.equal(row.status, "sent");
  assert.ok(row.sent_at);
});

test("a provider failure increments attempts and leaves status pending (retryable)", async () => {
  await inTenant(A.id, (tx) =>
    sendEmail(tx, { tenantId: A.id, to: "flaky@example.com", template: { subject: "F", html: "H" } }));

  const failingMailer = { async send() { throw new Error("SMTP down"); } };
  await deliverPendingEmails(admin, failingMailer, 100);

  const [row] = await admin`SELECT * FROM email_outbox WHERE tenant_id = ${A.id} AND to_email = 'flaky@example.com'`;
  assert.equal(row.status, "pending");
  assert.equal(row.attempts, 1);
  assert.match(row.last_error, /SMTP down/);
});

test("after N failed attempts, status becomes failed (no infinite retry)", async () => {
  await inTenant(A.id, (tx) =>
    sendEmail(tx, { tenantId: A.id, to: "dead@example.com", template: { subject: "D", html: "H" } }));

  const failingMailer = { async send() { throw new Error("permanent failure"); } };
  // MAX_ATTEMPTS is 5 — five delivery sweeps. deliverPendingEmails sweeps
  // EVERY tenant's pending queue (by design, see email.ts), so a generous
  // limit is used to make sure THIS row is included in each sweep rather
  // than starving behind other tests' leftover pending rows.
  for (let i = 0; i < 5; i++) {
    await deliverPendingEmails(admin, failingMailer, 1000);
  }

  const [row] = await admin`SELECT * FROM email_outbox WHERE tenant_id = ${A.id} AND to_email = 'dead@example.com'`;
  assert.equal(row.status, "failed");
  assert.equal(row.attempts, 5);
});
