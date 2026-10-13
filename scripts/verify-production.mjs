// scripts/verify-production.mjs — is the live site healthy? Read-only.
//
//   npm run verify:production -- https://acme.wola.app
//   npm run verify:production -- https://wola-pi.vercel.app --webhook   # also send a test alert
//
// Checks (each prints PASS/FAIL, exit code 1 if any fail):
//   - /api/health says {"ok":true} (the app is up AND the database answers)
//   - /api/health reveals nothing about any organisation
//   - /login and /admin/login load
//   - a wrong password is refused (not a 500)
// --webhook also posts a clearly-labelled TEST message to ERROR_WEBHOOK_URL (from your
// environment or .env), so you can see it arrive in Slack before you rely on it.
import "dotenv/config";

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? "").replace(/\/$/, "");
if (!base) { console.error("Usage: npm run verify:production -- https://your-domain [--webhook]"); process.exit(1); }

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
};
const get = async (p, init) => {
  const t0 = Date.now();
  const res = await fetch(base + p, { redirect: "manual", signal: AbortSignal.timeout(20_000), ...init });
  return { res, ms: Date.now() - t0, text: await res.text() };
};

try {
  const h = await get("/api/health");
  let body = null;
  try { body = JSON.parse(h.text); } catch { /* not json */ }
  check("health: 200 and ok:true", h.res.status === 200 && body?.ok === true, `HTTP ${h.res.status}, ${h.ms}ms`);
  check("health: reveals nothing about any organisation", body !== null && Object.keys(body).every((k) => k === "ok"), body ? Object.keys(body).join(",") : "not JSON");
  check("health: not cacheable", /no-store/.test(h.res.headers.get("cache-control") ?? ""));

  const login = await get("/login");
  check("/login loads", login.res.status === 200, `HTTP ${login.res.status}`);
  const admin = await get("/admin/login");
  check("/admin/login loads", admin.res.status === 200, `HTTP ${admin.res.status}`);

  const form = new URLSearchParams({ email: "verify@example.invalid", password: "definitely-wrong" });
  const bad = await get("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
  check("a wrong password is refused, not a server error", bad.res.status < 500, `HTTP ${bad.res.status}`);
} catch (e) {
  check("site reachable", false, e.message);
}

if (args.includes("--webhook")) {
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) check("webhook: ERROR_WEBHOOK_URL is set in this shell", false, "set it or put it in .env");
  else {
    try {
      const msg = "Wola TEST alert: if you can read this in the channel, error alerts reach you. Nothing is wrong.";
      const r = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: msg, content: msg }),
        signal: AbortSignal.timeout(10_000),
      });
      check("webhook: accepted the test message", r.ok, `HTTP ${r.status}. Now look in the channel.`);
    } catch (e) { check("webhook: reachable", false, e.message); }
  }
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
