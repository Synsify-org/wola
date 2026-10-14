// scripts/audit-mobile.mjs — does any page spill sideways on a phone?
//
//   npm run audit:mobile              # 390px wide (a common phone), every role, every page
//   npm run audit:mobile -- --width=360 --roles=cfo,employee --routes=/,/loans
//
// Starts the app, signs in as each demo role (a session row, as the rehearsal does),
// opens every page in headless Chrome at phone width and reports:
//   - pages whose document is wider than the screen (the whole page scrolls sideways), and
//   - the elements that stick out past the right edge, outside any scroll container
//     that is meant to scroll (tables inside overflow-x:auto are fine).
// Needs the demo database (npm run demo:reset) and Chrome or Edge installed.
import puppeteer from "puppeteer-core";
import postgres from "postgres";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import "dotenv/config";

// One or more widths, comma separated. 412 is a very common phone width (and the one that
// exposed layouts that only broke between the usual 360 and 390 test sizes).
const WIDTHS = (process.argv.find((a) => a.startsWith("--width=")) ?? "--width=390").split("=")[1].split(",").map(Number);
let WIDTH = WIDTHS[0];
const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) ?? "").split("=")[1] || null;
const URL_ARG = (process.argv.find((a) => a.startsWith("--url=")) ?? "").split("=").slice(1).join("=") || null; // reuse a running server
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PORT = Number(process.env.AUDIT_PORT ?? 3198);
const root = path.resolve(import.meta.dirname, "..");
const admin = process.env.DATABASE_ADMIN_URL;
if (!admin) { console.error("DATABASE_ADMIN_URL is required."); process.exit(1); }

const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && existsSync(p));
if (!CHROME) { console.error("No Chrome or Edge found. Set CHROME_PATH."); process.exit(1); }

const only = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? "").split("=")[1]?.split(",").filter(Boolean);
const ALL_ROLES = [
  ["cfo", "cfo@testco.io"], ["ceo", "ceo@testco.io"], ["hr", "hr@testco.io"],
  ["dept_head", "head@testco.io"], ["employee", "staff@testco.io"], ["org_admin", "admin@testco.io"],
];
const ALL_ROUTES = [
  "/", "/notifications", "/apply", "/applications", "/approvals", "/loans", "/book", "/analytics", "/reports", "/reconciliation", "/audit-log",
  "/settings", "/settings/employees", "/settings/products", "/settings/products/new", "/settings/routing",
  "/settings/access", "/settings/security",
];

const ROLES = only("roles") ? ALL_ROLES.filter(([r]) => only("roles").includes(r)) : ALL_ROLES;
const ROUTES = only("routes") ?? ALL_ROUTES;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32" });
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

let server = null;
const stop = () => { if (server) { if (process.platform === "win32") sh("taskkill", ["/pid", String(server.pid), "/T", "/F"]); else server.kill("SIGTERM"); } };
process.on("exit", stop);
if (!URL_ARG) {
  server = spawn("npx", ["next", "dev", "--webpack", "-p", String(PORT)], {
    cwd: path.join(root, "apps/web"), shell: process.platform === "win32",
    env: { ...process.env, WOLA_BASE_DOMAIN: "localhost", NEXT_TELEMETRY_DISABLED: "1" }, stdio: "ignore",
  });
  const ping = () => new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: "/login", headers: { host: `testco.localhost:${PORT}` }, timeout: 60_000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on("error", () => resolve(false)); req.on("timeout", () => { req.destroy(); resolve(false); }); req.end();
  });
  const t0 = Date.now();
  while (!(await ping())) {
    if (Date.now() - t0 > 180_000) { console.error("dev server did not start"); process.exit(1); }
    await sleep(2000);
  }
}
const BASE_URL = URL_ARG ?? `http://testco.localhost:${PORT}`;
const BASE_HOST = new URL(BASE_URL).hostname;

const sql = postgres(admin, { max: 1 });
const [tenant] = await sql`SELECT id FROM tenants WHERE slug = 'testco'`;
if (!tenant) { console.error("testco not found; run npm run demo:reset"); process.exit(1); }
const [loan] = await sql`SELECT id FROM loans WHERE tenant_id = ${tenant.id} AND status = 'active' LIMIT 1`;
const [appn] = await sql`SELECT id FROM loan_applications WHERE tenant_id = ${tenant.id} ORDER BY amount DESC LIMIT 1`; // the biggest: long amounts are what overflow
const routes = [...ROUTES, ...(loan ? [`/loans/${loan.id}`] : []), ...(appn ? [`/applications/${appn.id}`] : [])];

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: [`--host-resolver-rules=MAP ${BASE_HOST} 127.0.0.1`, "--no-sandbox"],
});

// Runs in the page. Two kinds of "bleed":
//   past-edge  an element reaches beyond the right edge of the screen and no ancestor
//              scrolls (overflow auto/scroll) to make that reachable;
//   clipped    an element is cut off by an ancestor with overflow hidden/clip, so part
//              of it can never be seen (text and controls half-hidden inside a card).
const probe = (width) => {
  const out = [];
  const label = (el, why, px) => {
    const cls = (typeof el.className === "string" ? el.className : "").trim().split(/\s+/).slice(0, 4).join(".");
    return `${why} ${el.tagName.toLowerCase()}${cls ? "." + cls : ""} (+${Math.round(px)}px) "${(el.textContent ?? "").trim().slice(0, 30)}"`;
  };
  const chain = (el) => { const a = []; for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) a.push(p); return a; };
  for (const el of document.body.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    if (cs.position === "fixed" || cs.display === "none" || cs.visibility === "hidden" || el.closest("svg") !== null && el.tagName.toLowerCase() !== "svg") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const anc = chain(el);
    // The app's own scrolling <main> is not "meant to scroll sideways": if its content is
    // wider than the screen, that IS the bug. Only inner wrappers (tables) are intentional.
    const scroller = anc.find((p) => p.tagName !== "MAIN" && p !== document.body && (() => { const o = getComputedStyle(p).overflowX; return o === "auto" || o === "scroll"; })());
    if (scroller) continue; // meant to scroll sideways (wide tables)
    // A box that hides its overflow while its CONTENT is wider than the box: text or controls
    // are being cut off (e.g. a long amount in a card). Decorations (svg) don't count.
    const hides = cs.overflowX === "hidden" || cs.overflowX === "clip";
    if (hides && el.clientWidth > 4 && el.tagName.toLowerCase() !== "svg" && !el.matches(".sr-only") && el.scrollWidth > el.clientWidth + 1) {
      const er = el.getBoundingClientRect();
      // The in-flow, visible text that actually pokes out (not decorations or sr-only helpers).
      const spill = [...el.querySelectorAll("*")].find((d) => {
        const c = getComputedStyle(d);
        return c.position !== "absolute" && c.position !== "fixed" && !d.closest("svg") && !d.closest(".sr-only")
          && (d.childNodes.length && [...d.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
          && d.getBoundingClientRect().right > er.right + 1;
      });
      if (spill) out.push(label(spill, "content-cut", spill.getBoundingClientRect().right - er.right));
    }
    // Past the screen edge, unless an ancestor that hides overflow ends first (then it is
    // "clipped", below, not "past-edge").
    const clipper = anc.find((p) => { const o = getComputedStyle(p).overflowX; return (o === "hidden" || o === "clip") && p.tagName !== "BODY"; });
    const clipRight = clipper ? clipper.getBoundingClientRect().right : Infinity;
    if (r.right > width + 1 && clipRight > width + 1 && cs.position !== "absolute") { out.push(label(el, "past-edge", r.right - width)); continue; }
    if (clipper && r.right > clipRight + 1 && cs.position !== "absolute" && el.tagName.toLowerCase() !== "svg") out.push(label(el, "clipped", r.right - clipRight));
  }
  // Page-level sideways scroll: the document OR the scrolling <main> is wider than the screen.
  const pageWide = Math.max(
    document.documentElement.scrollWidth - width,
    document.body.scrollWidth - width,
    ...[...document.querySelectorAll("main")].map((m) => m.scrollWidth - m.clientWidth),
  );
  // Tables that need a sideways scroll inside their card: allowed, but worth a look on a phone.
  const wide = [...document.querySelectorAll("table")]
    .filter((t) => { const w = t.closest("div"); return w && w.scrollWidth > w.clientWidth + 1 && t.getBoundingClientRect().width > width; })
    .map((t) => `table ${Math.round(t.getBoundingClientRect().width)}px wide, headers: ${[...t.querySelectorAll("th")].slice(0, 4).map((h) => h.textContent.trim()).filter(Boolean).join(" | ")}`);
  return { docWide: pageWide, offenders: out.slice(0, 5), total: out.length, wide };
};

const problems = [];
const wideTables = new Map();
let checks = 0;
for (const w of WIDTHS) {
WIDTH = w;
for (const [role, email] of ROLES) {
  const [u] = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (!u) continue;
  const token = randomBytes(32).toString("hex");
  await sql`INSERT INTO sessions (user_id, tenant_id, token_hash, expires_at) VALUES (${u.id}, ${tenant.id}, ${sha256(token)}, now() + interval '1 hour')`;
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: SHOTS ? 4200 : 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.setCookie({ name: "wola_session", value: token, domain: BASE_HOST, path: "/" });
  for (const route of routes) {
    checks++;
    try {
      await page.goto(`${BASE_URL}${route}`, { waitUntil: "load", timeout: 120_000 });
      await sleep(1500); // entrance animations settle
      const res = await page.evaluate(probe, WIDTH);
      if (SHOTS) {
        // Slices of at most 1400px so each image stays readable.
        const full = await page.evaluate(() => Math.max(document.body.scrollHeight, ...[...document.querySelectorAll("main, [data-scroll]")].map((e) => e.scrollHeight)));
        for (let y = 0, i = 1; y < Math.min(full, 4200); y += 1400, i++) {
          await page.screenshot({ path: path.join(SHOTS, `${role}${route.replace(/[^a-z0-9]+/gi, "_")}_${WIDTH}_${i}.png`), clip: { x: 0, y, width: WIDTH, height: Math.min(1400, 4200 - y) } });
        }
      }
      for (const t of res.wide ?? []) wideTables.set(`${page.url().replace(/^https?:\/\/[^/]+/, "")} @${WIDTH}px: ${t}`, true);
      if (res.docWide > 1 || res.total > 0) problems.push({ role, width: WIDTH, route: page.url().replace(/^https?:\/\/[^/]+/, ""), ...res });
    } catch (e) {
      // A redirect (e.g. a role that may not open the page) aborts the navigation: not a layout problem.
      if (!/ERR_ABORTED|Execution context was destroyed/.test(e.message)) problems.push({ role, route, docWide: 0, offenders: [`could not load: ${e.message}`], total: 1 });
    }
  }
  await page.close();
}
}
await browser.close();
await sql`DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at > now() AND created_at > now() - interval '2 hours' AND user_id IN (SELECT id FROM users WHERE email LIKE '%@testco.io'))`.catch(() => {});
await sql.end();

const widthsLabel = WIDTHS.map((w) => `${w}px`).join(", ");
if (wideTables.size) {
  console.log(`
Tables that scroll sideways inside their card (allowed, but check they are readable on a phone):`);
  for (const k of wideTables.keys()) console.log(`  ${k}`);
}
if (problems.length === 0) {
  console.log(`
No page spills sideways at ${widthsLabel} (${checks} checks, ${ROLES.length} roles).`);
  process.exit(0);
}
// Group by page and width: the same page for several roles is one finding.
const byRoute = new Map();
for (const p of problems) { const k = `${p.route} @${p.width}px`; (byRoute.get(k) ?? byRoute.set(k, []).get(k)).push(p); }
console.log(`
${byRoute.size} finding(s):
`);
for (const [route, ps] of byRoute) {
  const worst = ps.sort((a, b) => b.docWide - a.docWide)[0];
  console.log(`${route}   roles: ${ps.map((p) => p.role).join(", ")}   page is ${Math.max(0, worst.docWide)}px too wide`);
  for (const o of worst.offenders) console.log(`    ${o}`);
}
process.exit(1);
