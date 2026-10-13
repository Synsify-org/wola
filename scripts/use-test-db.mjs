// scripts/use-test-db.mjs — preloaded (node --import) by the test scripts, AFTER
// dotenv, so the suite never touches the development database.
//
// The tests INSERT and DELETE whole fixture tenants (slugs like 'acc-t',
// 'mfa-t', 'cfg-a'). Run against the dev database they left ~30 junk tenants
// next to the demo data and made "one DB per environment" untrue. Locally the
// suite now runs against a separate `wola_test` database; this file points
// DATABASE_URL / DATABASE_ADMIN_URL there, and refuses to run if the target
// doesn't look like a test database.
//
// CI is unchanged: its Postgres is already a throwaway container (CI=true), so
// the URLs it sets are used as given.
const swapDb = (u, name) => {
  const x = new URL(u);
  x.pathname = `/${name}`;
  return x.toString();
};

const TEST_DB = process.env.WOLA_TEST_DB ?? "wola_test";

if (!process.env.CI) {
  for (const k of ["DATABASE_URL", "DATABASE_ADMIN_URL"]) {
    if (!process.env[k]) { console.error(`${k} is not set (copy .env.example to .env).`); process.exit(1); }
    process.env[k] = swapDb(process.env[k], TEST_DB);
  }
}

// Belt and braces: whatever the URLs ended up as, they must be a test database
// (or CI's own), so a mis-set variable can never aim the fixtures at real data.
const target = new URL(process.env.DATABASE_ADMIN_URL ?? "postgres://x/none");
const dbName = target.pathname.slice(1);
if (!process.env.CI && !/test/i.test(dbName)) {
  console.error(`Refusing to run tests against database "${dbName}": it isn't a test database.`);
  process.exit(1);
}
