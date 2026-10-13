// scripts/restore-check.mjs — prove a backup can be restored into a FRESH
// database and still be Wola: same data, same row-level-security policies, same
// grants, and the runtime role still can't see across tenants.
//
//   npm run restore:check
//
// "A backup you have never restored is a hope, not a backup." This is the drill.
// It dumps the local database inside the Postgres container (so it needs no
// client tools on your machine), restores into a scratch database, compares, and
// drops the scratch database. For the hosted database, follow
// docs/OPERATIONS.md (restore into a new project, then run the same comparisons).
import postgres from "postgres";
import { spawnSync } from "node:child_process";
import "dotenv/config";

const admin = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
if (!admin || !appUrl) { console.error("DATABASE_ADMIN_URL and DATABASE_URL are required."); process.exit(1); }
const CONTAINER = process.env.WOLA_PG_CONTAINER ?? "wola-postgres-1";
const SCRATCH = "wola_restore_check";

const au = new URL(admin);
const source = au.pathname.slice(1);
const user = decodeURIComponent(au.username);
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString(); };

const dx = (args) => {
  const r = spawnSync("docker", ["exec", CONTAINER, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`docker exec ${args.slice(0, 3).join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
};
const step = (m) => console.log(`\n${m}`);
const problems = [];
const check = (ok, msg) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) problems.push(msg); };

let src, dst, dstApp, srcApp;
try {
  step(`1. Dump "${source}" (custom format, inside the container)`);
  dx(["pg_dump", "-U", user, "-Fc", "-f", "/tmp/wola-restore-check.dump", source]);
  const size = dx(["sh", "-c", "wc -c < /tmp/wola-restore-check.dump"]).trim();
  console.log(`  dump written: ${Math.round(Number(size) / 1024)} KB`);

  step(`2. Restore into a fresh database "${SCRATCH}"`);
  dx(["dropdb", "-U", user, "--if-exists", SCRATCH]);
  dx(["createdb", "-U", user, SCRATCH]);
  // --no-owner/--no-privileges would HIDE exactly the grants we want to prove survive, so neither is used.
  const rest = spawnSync("docker", ["exec", CONTAINER, "pg_restore", "-U", user, "-d", SCRATCH, "--exit-on-error", "/tmp/wola-restore-check.dump"], { encoding: "utf8" });
  if (rest.status !== 0) throw new Error(`pg_restore failed: ${(rest.stderr || rest.stdout).trim()}`);
  console.log("  restored without errors");

  src = postgres(admin, { max: 1 });
  dst = postgres(withDb(admin, SCRATCH), { max: 1 });

  step("3. Data: every table has the same number of rows");
  const tables = (await src`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`).map((r) => r.tablename);
  const dstTables = (await dst`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`).map((r) => r.tablename);
  check(JSON.stringify(tables) === JSON.stringify(dstTables), `same ${tables.length} tables`);
  let rowsOk = true, total = 0;
  for (const t of tables) {
    const [a] = await src.unsafe(`SELECT count(*)::int AS n FROM "${t}"`);
    const [b] = await dst.unsafe(`SELECT count(*)::int AS n FROM "${t}"`);
    total += a.n;
    if (a.n !== b.n) { rowsOk = false; check(false, `${t}: ${a.n} rows in source, ${b.n} restored`); }
  }
  check(rowsOk, `all rows restored (${total} rows across ${tables.length} tables)`);

  step("4. Row-level security: policies and flags");
  const pol = (db) => db`SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`;
  const [sp, dp] = [await pol(src), await pol(dst)];
  check(sp.length > 0 && JSON.stringify(sp) === JSON.stringify(dp), `${sp.length} policies identical`);
  const flags = (db) => db`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND relkind = 'r' ORDER BY 1`;
  const [sf, df] = [await flags(src), await flags(dst)];
  check(JSON.stringify(sf) === JSON.stringify(df), `ENABLE/FORCE row security flags identical on ${sf.length} tables (${sf.filter((r) => r.relforcerowsecurity).length} forced)`);

  step("5. Grants: what the runtime role may do");
  const grants = (db) => db`SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'wola_app' AND table_schema = 'public' ORDER BY 1, 2`;
  const colGrants = (db) => db`SELECT table_name, column_name, privilege_type FROM information_schema.column_privileges WHERE grantee = 'wola_app' AND table_schema = 'public' AND privilege_type = 'UPDATE' ORDER BY 1, 2, 3`;
  const [sg, dg] = [await grants(src), await grants(dst)];
  check(sg.length > 0 && JSON.stringify(sg) === JSON.stringify(dg), `${sg.length} table grants for wola_app identical`);
  const [sc, dc] = [await colGrants(src), await colGrants(dst)];
  check(JSON.stringify(sc) === JSON.stringify(dc), "column-level UPDATE grants identical (e.g. tenants.settings)");

  step("6. Behaviour: the restored database still isolates tenants for the runtime role");
  srcApp = postgres(appUrl, { max: 1 });
  dstApp = postgres(withDb(appUrl, SCRATCH), { max: 1 });
  const noContext = async (db) => (await db`SELECT count(*)::int AS n FROM employees`)[0].n;
  check((await noContext(dstApp)) === 0, "with no tenant context, the app role sees 0 employees");
  const [t] = await src`SELECT id FROM tenants WHERE slug = 'testco'`;
  if (t) {
    const inTenant = (db) => db.begin(async (tx) => { await tx`SELECT set_config('app.tenant_id', ${t.id}, true)`; return (await tx`SELECT count(*)::int AS n FROM employees`)[0].n; });
    const [a, b] = [await inTenant(srcApp), await inTenant(dstApp)];
    check(a > 0 && a === b, `inside the demo tenant both databases show ${a} employees`);
  } else {
    console.log("  (no 'testco' tenant to test with; run npm run demo:reset first for the full check)");
  }
  const fns = await dst`SELECT proname FROM pg_proc WHERE proname = 'current_tenant_id'`;
  check(fns.length === 1, "current_tenant_id() restored");
} catch (e) {
  problems.push(e.message);
  console.error("\n" + e.message);
} finally {
  for (const c of [src, dst, srcApp, dstApp]) { try { await c?.end({ timeout: 2 }); } catch {} }
  try { dx(["dropdb", "-U", user, "--if-exists", SCRATCH]); dx(["rm", "-f", "/tmp/wola-restore-check.dump"]); } catch {}
}

if (problems.length) {
  console.error(`\nRESTORE CHECK FAILED (${problems.length}):\n - ${problems.join("\n - ")}`);
  process.exit(1);
}
console.log("\nRESTORE CHECK PASSED: a restore reproduces the data, the RLS policies and the grants, and tenants stay isolated.");
