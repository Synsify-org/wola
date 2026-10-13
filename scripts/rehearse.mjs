// scripts/rehearse.mjs — the cold-start rehearsal, as one command.
//
//   npm run rehearse            # database up -> migrate -> demo reset -> server -> click-through
//   npm run rehearse -- --cold  # first STOP the local Postgres container, so the run also proves a cold database start
//
// What "click-through" means here: for each of the eight roles, sign in without
// typing (a session row is created directly), then request every page and check
// it renders without a server error, with exactly one <h1>, and that nothing is
// streamed in as an error boundary. It is the same set of pages a person would
// open on a demo, in the same order, every time.
//
// It cannot reboot your machine; --cold is the closest honest equivalent (the
// database is down at the start and the dev server is not running).
import postgres from "postgres";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import "dotenv/config";

const cold = process.argv.includes("--cold");
const PORT = Number(process.env.REHEARSE_PORT ?? 3199);
const CONTAINER = process.env.WOLA_PG_CONTAINER ?? "wola-postgres-1";
const root = path.resolve(import.meta.dirname, "..");
const admin = process.env.DATABASE_ADMIN_URL;
if (!admin) { console.error("DATABASE_ADMIN_URL is required (copy .env.example to .env)."); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(m);
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32", ...opts });

async function waitForDb(maxMs = 90_000) {
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < maxMs) {
    const sql = postgres(admin, { max: 1, connect_timeout: 3 });
    try { await sql`SELECT 1`; await sql.end(); return Date.now() - t0; }
    catch (e) { last = e.message; try { await sql.end({ timeout: 1 }); } catch {} await sleep(1500); }
  }
  throw new Error(`database did not become ready in ${maxMs / 1000}s (${last})`);
}

// ---------------------------------------------------------------- 1. database
log(`\n[1/5] Database${cold ? " (cold: stopping it first)" : ""}`);
if (cold) { sh("docker", ["stop", CONTAINER]); log("      stopped; it is now down."); }
const up = sh("docker", ["start", CONTAINER]);
if (up.status !== 0 && !/already|is running/i.test(up.stdout + up.stderr)) {
  log(`      "docker start ${CONTAINER}" said: ${(up.stderr || up.stdout).trim() || "(nothing)"} — assuming the database is managed another way.`);
}
const dbMs = await waitForDb();
log(`      ready after ${(dbMs / 1000).toFixed(1)}s`);

// ----------------------------------------------------- 2. migrate + 3. reset
log("\n[2/5] Migrations");
let r = sh(process.execPath, [path.join(root, "scripts/migrate.mjs")], { cwd: root, shell: false });
if (r.status !== 0) { console.error(r.stdout + r.stderr); process.exit(1); }
log("      " + (r.stdout.match(/migrations complete/) ? "up to date" : r.stdout.trim().split("\n").pop()));

log("\n[3/5] Demo reset");
r = sh(process.execPath, ["--import", "tsx", "--import", "dotenv/config", path.join(root, "scripts/demo-reset.mjs")], { cwd: root, shell: false });
if (r.status !== 0) { console.error(r.stdout + r.stderr); process.exit(1); }
log("      known-good state restored");

// ------------------------------------------------------------------ 4. server
log(`\n[4/5] Dev server on :${PORT}`);
const server = spawn("npx", ["next", "dev", "--webpack", "-p", String(PORT)], {
  cwd: path.join(root, "apps/web"), shell: process.platform === "win32",
  env: { ...process.env, WOLA_BASE_DOMAIN: "localhost", NEXT_TELEMETRY_DISABLED: "1" }, stdio: "ignore",
});
const stopServer = () => {
  if (process.platform === "win32") sh("taskkill", ["/pid", String(server.pid), "/T", "/F"]);
  else server.kill("SIGTERM");
};
process.on("exit", stopServer);

// Node's resolver can't look up *.localhost on every OS (ENOTFOUND on Windows),
// and fetch() won't let us set Host. So talk to 127.0.0.1 with node:http and the
// tenant's Host header: exactly what the browser's request looks like to the app.
const HOST = `testco.localhost:${PORT}`;
const get = (route, headers = {}, timeout = 120_000) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: PORT, path: route, method: "GET", headers: { host: HOST, ...headers }, timeout },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      },
    );
    req.on("timeout", () => req.destroy(new Error(`timed out after ${timeout / 1000}s`)));
    req.on("error", reject);
    req.end();
  });
const t0 = Date.now();
for (;;) {
  try { const res = await get("/login", {}, 60_000); if (res.status === 200) break; } catch {}
  if (Date.now() - t0 > 180_000) { console.error("dev server did not start in 180s"); process.exit(1); }
  await sleep(2000);
}
log(`      serving after ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// -------------------------------------------------------------- 5. click-through
log("\n[5/5] Click-through, every role, every page");
const sql = postgres(admin, { max: 1 });
const [tenant] = await sql`SELECT id FROM tenants WHERE slug = 'testco'`;
const ROLES = [
  ["cfo", "cfo@testco.io"], ["ceo", "ceo@testco.io"], ["coo", "coo@testco.io"], ["hr", "hr@testco.io"],
  ["dept_head", "head@testco.io"], ["employee", "staff@testco.io"], ["org_admin", "admin@testco.io"], ["auditor", "auditor@testco.io"],
];
const ROUTES = [
  "/", "/apply", "/applications", "/approvals", "/loans", "/book", "/analytics", "/reports", "/reconciliation", "/audit-log",
  "/settings", "/settings/employees", "/settings/products", "/settings/products/new", "/settings/routing",
  "/settings/access", "/settings/security",
];
// A failure that happens AFTER the page shell has streamed is delivered as
// <template data-dgst="...">. Redirects and notFound() are delivered the same
// way but are normal behaviour (e.g. an employee opening /book is sent to /loans),
// so those digests are told apart from real errors, which carry a numeric digest.
const ERROR_MARKERS = [/Application error/i, /Internal Server Error/i, /Unhandled Runtime Error/i];
const digestsOf = (body) => [...body.matchAll(/data-dgst="([^"]+)"/g)].map((m) => m[1]);
const isBenign = (d) => d.startsWith("NEXT_REDIRECT") || d.includes("NEXT_HTTP_ERROR_FALLBACK") || d === "NEXT_NOT_FOUND";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const failures = [];
const rows = [];
const tokens = [];

for (const [role, email] of ROLES) {
  const [u] = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (!u) { failures.push(`${role}: user ${email} missing`); continue; }
  const token = randomBytes(32).toString("hex");
  tokens.push(sha256(token));
  await sql`INSERT INTO sessions (user_id, tenant_id, token_hash, expires_at)
            VALUES (${u.id}, ${tenant.id}, ${sha256(token)}, now() + interval '1 hour')`;

  const cell = [];
  for (const route of ROUTES) {
    const started = Date.now();
    let status = 0, body = "", err = "";
    try {
      const res = await get(route, { cookie: `wola_session=${token}` });
      status = res.status; body = res.body;
      if (process.env.REHEARSE_DUMP && route === process.env.REHEARSE_DUMP && role === (process.env.REHEARSE_DUMP_ROLE ?? "cfo")) writeFileSync(process.env.REHEARSE_DUMP_FILE, body);
    } catch (e) { err = e.message; }
    const ms = Date.now() - started;
    const digests = digestsOf(body);
    const redirect = (body.match(/http-equiv="refresh" content="\d+;url=([^"]+)"/) ?? [])[1] ?? digests.find((d) => d.startsWith("NEXT_REDIRECT"));
    const benignStop = Boolean(redirect) || digests.some(isBenign);
    const realErrors = digests.filter((d) => !isBenign(d));
    const h1s = (body.match(/<h1[\s>]/g) ?? []).length;
    let problem = "";
    if (err) problem = `request failed: ${err}`;
    else if (status >= 500) problem = `HTTP ${status}`;
    else if (status >= 300 && status < 400) problem = ""; // a normal redirect
    else if (realErrors.length || ERROR_MARKERS.some((m) => m.test(body))) problem = `server error streamed into the page (ref ${realErrors[0] ?? "?"})`;
    else if (!benignStop && h1s !== 1) problem = `${h1s} <h1> elements`;
    if (problem) failures.push(`${role} ${route}: ${problem}`);
    cell.push(problem ? "FAIL" : benignStop || (status >= 300 && status < 400) ? "redir" : "ok");
    if (ms > 30_000) failures.push(`${role} ${route}: took ${(ms / 1000).toFixed(0)}s`);
  }
  rows.push([role, ...cell]);
  log(`      ${role.padEnd(10)} ${cell.map((c) => (c === "ok" ? "." : c === "redir" ? "r" : "X")).join("")}`);
}
await sql`DELETE FROM sessions WHERE token_hash = ANY(${tokens})`;

// Public + health.
for (const route of ["/login", "/robots.txt", "/sitemap.xml", "/llms.txt", "/api/health"]) {
  const res = await get(route);
  if (res.status !== 200) failures.push(`public ${route}: HTTP ${res.status}`);
}
await sql.end();

log(`\n      legend: . ok   r redirect   X problem        (${ROUTES.length} pages x ${ROLES.length} roles = ${ROUTES.length * ROLES.length} checks)`);
stopServer();
if (failures.length) {
  console.error(`\nREHEARSAL FAILED (${failures.length}):\n - ` + failures.join("\n - "));
  process.exit(1);
}
log("\nREHEARSAL PASSED: database, migrations, reset, server and every page for every role, with zero errors.");
process.exit(0);
