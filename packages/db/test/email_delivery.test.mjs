// Sending email from inside the app: one organisation at a time, through its own transaction.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { sendEmail, deliverTenantEmails, deliverAllTenantEmails, wrapEmail, htmlToText, setEmailQueuedHook } from "../src/email.ts";
import { makeResendMailer } from "../src/mailer-resend.ts";
import { tenantTx } from "../src/client.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
let admin, app, A, B;

const queue = (tid, to, subject = "S", html = "<p>Hello</p>", data) =>
  tenantTx(app, tid, (tx) => sendEmail(tx, { tenantId: tid, to, template: { subject, html }, data }));
const row = (to) => admin`SELECT * FROM email_outbox WHERE to_email = ${to}`.then((r) => r[0]);
const recorder = () => { const sent = []; return { sent, async send(m) { sent.push(m); } }; };

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 3 });
  await admin`DELETE FROM email_outbox WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('edl-a','edl-b'))`;
  await admin`DELETE FROM tenants WHERE slug IN ('edl-a','edl-b')`;
  [A] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('edl-a','Alpha Insurance','active') RETURNING id`;
  [B] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('edl-b','Beta Bank','active') RETURNING id`;
});
after(async () => {
  setEmailQueuedHook(null);
  await admin`DELETE FROM email_outbox WHERE tenant_id IN (${A.id}, ${B.id})`;
  await admin`DELETE FROM tenants WHERE slug IN ('edl-a','edl-b')`;
  await app.end(); await admin.end();
});

test("it sends one organisation's mail and leaves every other organisation's queued", async () => {
  await queue(A.id, "a1@edl.t"); await queue(B.id, "b1@edl.t");
  const m = recorder();
  const r = await deliverTenantEmails(app, A.id, m);
  assert.equal(r.sent, 1);
  assert.deepEqual(m.sent.map((x) => x.to), ["a1@edl.t"]);
  assert.equal((await row("a1@edl.t")).status, "sent");
  assert.ok((await row("a1@edl.t")).sent_at);
  assert.equal((await row("b1@edl.t")).status, "pending", "Beta's mail is not touched by Alpha's send");
});

test("what is sent is wrapped in the organisation's name and carries a plain-text copy", async () => {
  await queue(A.id, "wrap@edl.t", "Hi", '<p>Go <a href="https://x.test/a?b=1&amp;c=2">here</a></p>');
  const m = recorder();
  await deliverTenantEmails(app, A.id, m);
  const msg = m.sent.find((x) => x.to === "wrap@edl.t");
  assert.match(msg.html, /Alpha Insurance/);
  assert.match(msg.html, /<a href="https:\/\/x\.test/);
  assert.match(msg.text, /here \(https:\/\/x\.test\/a\?b=1&c=2\)/, "the plain-text link is decoded, so it can be pasted");
  assert.doesNotMatch(msg.text, /<[a-z]/);
});

test("a failed send is recorded and retried; after five attempts it stops", async () => {
  await queue(A.id, "flaky@edl.t");
  const bad = { async send() { throw new Error("provider down"); } };
  let r = await deliverTenantEmails(app, A.id, bad);
  assert.equal(r.failed, 1);
  let x = await row("flaky@edl.t");
  assert.equal(x.status, "pending"); assert.equal(x.attempts, 1); assert.match(x.last_error, /provider down/);
  assert.equal(x.claimed_at, null, "the lease is released so the next attempt can claim it");
  for (let i = 0; i < 4; i++) await deliverTenantEmails(app, A.id, bad);
  x = await row("flaky@edl.t");
  assert.equal(x.status, "failed"); assert.equal(x.attempts, 5);
  const good = recorder();
  await deliverTenantEmails(app, A.id, good);
  assert.ok(!good.sent.some((s) => s.to === "flaky@edl.t"), "a failed email is not retried forever");
});

test("a recovered provider sends what failed earlier, and clears the error", async () => {
  await queue(A.id, "recover@edl.t");
  await deliverTenantEmails(app, A.id, { async send() { throw new Error("blip"); } });
  const m = recorder();
  await deliverTenantEmails(app, A.id, m);
  const x = await row("recover@edl.t");
  assert.equal(x.status, "sent"); assert.equal(x.last_error, null);
});

test("an email being sent by another request is not sent twice (the lease)", async () => {
  await queue(A.id, "lease@edl.t");
  await admin`UPDATE email_outbox SET claimed_at = now() WHERE to_email = 'lease@edl.t'`;
  const m = recorder();
  await deliverTenantEmails(app, A.id, m);
  assert.ok(!m.sent.some((s) => s.to === "lease@edl.t"));
  await admin`UPDATE email_outbox SET claimed_at = now() - interval '10 minutes' WHERE to_email = 'lease@edl.t'`;
  await deliverTenantEmails(app, A.id, m);
  assert.ok(m.sent.some((s) => s.to === "lease@edl.t"), "an abandoned claim is picked up again after the lease ends");
});

test("two sends at the same moment deliver each email once", async () => {
  for (let i = 0; i < 6; i++) await queue(B.id, `race${i}@edl.t`);
  const m = recorder();
  await Promise.all([deliverTenantEmails(app, B.id, m), deliverTenantEmails(app, B.id, m), deliverTenantEmails(app, B.id, m)]);
  const mine = m.sent.filter((s) => s.to.startsWith("race"));
  assert.equal(mine.length, 6);
  assert.equal(new Set(mine.map((s) => s.to)).size, 6, "no email went out twice");
});

test("mail that waited more than three days is not sent, and says why", async () => {
  await queue(A.id, "old@edl.t");
  await admin`UPDATE email_outbox SET created_at = now() - interval '4 days' WHERE to_email = 'old@edl.t'`;
  const m = recorder();
  const r = await deliverTenantEmails(app, A.id, m);
  assert.ok(r.expired >= 1);
  assert.ok(!m.sent.some((s) => s.to === "old@edl.t"));
  const x = await row("old@edl.t");
  assert.equal(x.status, "failed"); assert.match(x.last_error, /not sent within 3 days/);
});

test("the retry sweep covers every active organisation", async () => {
  await queue(A.id, "sweep-a@edl.t"); await queue(B.id, "sweep-b@edl.t");
  const m = recorder();
  await deliverAllTenantEmails(app, m);
  const to = m.sent.map((s) => s.to);
  assert.ok(to.includes("sweep-a@edl.t") && to.includes("sweep-b@edl.t"));
});

test("a person's name cannot add markup to an email, and a subject stays one line", async () => {
  await queue(A.id, "xss@edl.t", "Hello {{n}}\r\nBcc: evil@x.test", "<p>Dear {{n}}</p>", { n: '<img src=x onerror=alert(1)> "Ann"' });
  const x = await row("xss@edl.t");
  assert.doesNotMatch(x.body_html, /<img/);
  assert.match(x.body_html, /&lt;img src=x onerror=alert\(1\)&gt; &quot;Ann&quot;/);
  assert.doesNotMatch(x.subject, /[\r\n]/);
});

test("tenantTx asks the app to send only after mail was queued and the transaction committed", async () => {
  const calls = [];
  setEmailQueuedHook((tid) => calls.push(tid));
  await tenantTx(app, A.id, async (tx) => { await tx`SELECT 1`; });
  assert.deepEqual(calls, [], "no mail queued, no send");
  await assert.rejects(tenantTx(app, A.id, async (tx) => {
    await sendEmail(tx, { tenantId: A.id, to: "rolledback@edl.t", template: { subject: "s", html: "h" } });
    throw new Error("the action failed");
  }));
  assert.deepEqual(calls, [], "a rolled-back transaction sends nothing");
  assert.equal((await admin`SELECT 1 FROM email_outbox WHERE to_email = 'rolledback@edl.t'`).length, 0);
  await queue(A.id, "hooked@edl.t");
  assert.deepEqual(calls, [A.id]);
  setEmailQueuedHook(() => { throw new Error("hook blew up"); });
  await queue(A.id, "hookfail@edl.t"); // must not throw: the email stays queued
  assert.equal((await row("hookfail@edl.t")).status, "pending");
  setEmailQueuedHook(null);
});

test("wrapEmail escapes the organisation name; htmlToText keeps links and drops tags", () => {
  assert.match(wrapEmail("<p>x</p>", "<script>Co</script>"), /&lt;script&gt;Co&lt;\/script&gt;/);
  assert.equal(htmlToText("<p>One</p><p>Two <b>bold</b></p>"), "One\n\nTwo bold");
});

test("the Resend mailer posts the right request and reports a refusal without leaking the key", async () => {
  let seen;
  const ok = makeResendMailer({
    apiKey: "re_secret_key", from: "Wola <no-reply@bookings.synsify.africa>", replyTo: "help@synsify.africa",
    fetchImpl: async (url, init) => { seen = { url, init }; return new Response("{}", { status: 200 }); },
  });
  await ok.send({ to: "x@y.test", subject: "Hi", html: "<p>Hi</p>", text: "Hi" });
  assert.equal(seen.url, "https://api.resend.com/emails");
  assert.equal(seen.init.headers.authorization, "Bearer re_secret_key");
  const body = JSON.parse(seen.init.body);
  assert.deepEqual(body.to, ["x@y.test"]);
  assert.equal(body.from, "Wola <no-reply@bookings.synsify.africa>");
  assert.equal(body.reply_to, "help@synsify.africa");
  assert.equal(body.text, "Hi");

  const refused = makeResendMailer({ apiKey: "re_secret_key", from: "a@b.test", fetchImpl: async () => new Response('{"message":"domain not verified"}', { status: 403 }) });
  await assert.rejects(refused.send({ to: "x@y.test", subject: "s", html: "h" }), (e) => /403/.test(e.message) && /domain not verified/.test(e.message) && !/re_secret_key/.test(e.message));
});

test("sends are spaced out, and a 'slow down' answer is waited out and retried", async () => {
  const waits = [], calls = [];
  const answers = [429, 200, 200];
  const m = makeResendMailer({
    apiKey: "k", from: "a@b.test", minGapMs: 500,
    sleep: async (ms) => { waits.push(ms); },
    fetchImpl: async () => { calls.push(1); const s = answers.shift() ?? 200; return new Response("{}", { status: s, headers: s === 429 ? { "retry-after": "2" } : {} }); },
  });
  await m.send({ to: "a@y.test", subject: "s", html: "h" });
  assert.equal(calls.length, 2, "the 429 was retried once and then succeeded");
  assert.ok(waits.includes(2000), "it waited the two seconds Resend asked for");
  await m.send({ to: "b@y.test", subject: "s", html: "h" });
  assert.equal(calls.length, 3);
  assert.ok(waits.some((w) => w > 0 && w <= 500), "back-to-back sends are spaced by the minimum gap");

  const always429 = makeResendMailer({ apiKey: "k", from: "a@b.test", sleep: async () => {}, fetchImpl: async () => new Response("{}", { status: 429 }) });
  await assert.rejects(always429.send({ to: "x@y.test", subject: "s", html: "h" }), /429/, "it gives up after three tries instead of looping");
});

test("an organisation that switches email off queues nothing; every other organisation is unaffected", async () => {
  await admin`UPDATE tenants SET settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{email}', '{"enabled": false}'::jsonb) WHERE id = ${B.id}`;
  try {
    const hook = []; setEmailQueuedHook((tid) => hook.push(tid));
    const off = await tenantTx(app, B.id, (tx) => sendEmail(tx, { tenantId: B.id, to: "demo@off.t", template: { subject: "s", html: "h" } }));
    assert.equal(off.id, null, "no row, no id");
    assert.equal((await admin`SELECT 1 FROM email_outbox WHERE to_email = 'demo@off.t'`).length, 0);
    assert.deepEqual(hook, [], "nothing queued means no send is requested");
    const on = await tenantTx(app, A.id, (tx) => sendEmail(tx, { tenantId: A.id, to: "real@on.t", template: { subject: "s", html: "h" } }));
    assert.ok(on.id, "another organisation still queues mail");
    assert.deepEqual(hook, [A.id]);
    setEmailQueuedHook(null);
    // Turning it back on (or never setting it) means mail is queued as normal.
    await admin`UPDATE tenants SET settings = settings - 'email' WHERE id = ${B.id}`;
    assert.ok((await tenantTx(app, B.id, (tx) => sendEmail(tx, { tenantId: B.id, to: "back@on.t", template: { subject: "s", html: "h" } }))).id);
  } finally {
    await admin`UPDATE tenants SET settings = settings - 'email' WHERE id = ${B.id}`;
  }
});

test("addresses on reserved names are never queued, so practice accounts cannot cause bounces", async () => {
  for (const to of ["practice.hr@mua-trial.invalid", "a@b.test", "a@b.example", "a@host.localhost", "A@Trial.INVALID "]) {
    const r = await tenantTx(app, A.id, (tx) => sendEmail(tx, { tenantId: A.id, to, template: { subject: "s", html: "h" } }));
    assert.equal(r.id, null, to);
  }
  assert.equal((await admin`SELECT 1 FROM email_outbox WHERE to_email ILIKE '%trial.invalid' OR to_email IN ('a@b.test','a@b.example','a@host.localhost')`).length, 0);
  const real = await tenantTx(app, A.id, (tx) => sendEmail(tx, { tenantId: A.id, to: "person@mua.co.ug", template: { subject: "s", html: "h" } }));
  assert.ok(real.id, "a real address is queued as normal");
});
