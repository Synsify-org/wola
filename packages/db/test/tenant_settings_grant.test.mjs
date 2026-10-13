// White-label theme saving writes tenants.settings as the RUNTIME role. The app
// role is read-only on `tenants` except for that one column (migration 0010's
// column-scoped grant). This pins both halves: the exact UPDATE saveThemeAction
// issues succeeds, and nothing else on the row can be changed.
// (An earlier bug: the theme UPDATE also touched updated_at, a column the grant
// doesn't cover, so every save failed with "permission denied".)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
let admin, app, T;

before(async () => {
  admin = postgres(ADMIN, { max: 1 });
  app = postgres(APP, { max: 1 });
  await admin`DELETE FROM tenants WHERE slug = 'theme-t'`;
  const [t] = await admin`INSERT INTO tenants (slug,name,status) VALUES ('theme-t','Theme Test','active') RETURNING id`;
  T = t.id;
});
after(async () => { await app.end(); await admin.end(); });

const asApp = (fn) => app.begin(async (tx) => { await tx`SELECT set_config('app.tenant_id', ${T}, true)`; return fn(tx); });

test("migration 0010's column grant is in place: the runtime role may update tenants.settings", async () => {
  const [g] = await admin`
    SELECT has_column_privilege('wola_app', 'tenants', 'settings', 'UPDATE') AS can`;
  assert.equal(g.can, true);
});

test("the exact UPDATE saveThemeAction issues works, without touching any other column", async () => {
  const brand = { primary: "#123456", accent: "#abcdef", font: "inter" };
  await asApp((tx) => tx`
    UPDATE tenants
    SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{brand}', ${tx.json(brand)}::jsonb, true)
    WHERE id = ${T}`);
  const [row] = await admin`SELECT settings FROM tenants WHERE id = ${T}`;
  assert.deepEqual(row.settings.brand, brand);
});

test("a second write keeps other settings keys (theme save must not erase the security policy)", async () => {
  await admin`UPDATE tenants SET settings = jsonb_set(settings, '{security}', '{"mfaRequiredRoles":["cfo"]}'::jsonb) WHERE id = ${T}`;
  await asApp((tx) => tx`
    UPDATE tenants SET settings = jsonb_set(settings, '{brand}', ${tx.json({ primary: "#000000", accent: "#ffffff", font: "outfit" })}::jsonb, true)
    WHERE id = ${T}`);
  const [row] = await admin`SELECT settings FROM tenants WHERE id = ${T}`;
  assert.deepEqual(row.settings.security, { mfaRequiredRoles: ["cfo"] });
  assert.equal(row.settings.brand.primary, "#000000");
});

test("nothing else on the tenant row is writable by the runtime role", async () => {
  for (const col of ["name", "slug", "status", "plan", "currency"]) {
    await assert.rejects(
      asApp((tx) => tx.unsafe(`UPDATE tenants SET ${col} = ${col} WHERE id = '${T}'`)),
      /permission denied/i,
      `updating tenants.${col} must be refused`,
    );
  }
  await assert.rejects(
    asApp((tx) => tx`UPDATE tenants SET settings = '{}'::jsonb, updated_at = now() WHERE id = ${T}`),
    /permission denied/i,
    "touching updated_at alongside settings is exactly the old bug",
  );
});
