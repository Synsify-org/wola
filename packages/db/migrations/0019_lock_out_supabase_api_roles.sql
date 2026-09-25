-- 0019_lock_out_supabase_api_roles.sql — close the Supabase Data API door on
-- the global (non-tenant) tables.
--
-- Supabase exposes the `public` schema over PostgREST ("Data API") to its
-- built-in `anon` and `authenticated` roles, and by default grants those
-- roles ALL on every table the `postgres` role creates. Wola never uses the
-- Data API — the app connects to Postgres directly — but the nine global
-- tables below had RLS disabled, so anyone holding the project's anon key
-- (publishable by Supabase's design) could read e.g. `users` (password
-- hashes) or `sessions` through the REST endpoint. Tenant tables were never
-- affected: they have FORCED RLS keyed on app.tenant_id, which the API roles
-- never set.
--
-- These nine stay OUTSIDE tenant RLS on purpose (DECISIONS.md: sessions,
-- users, tenants etc. are read before any tenant context exists). So this
-- does not scope them per tenant; it only shuts the API roles out:
--   1. Revoke every privilege the API roles hold in `public` — existing
--      objects AND future ones (default privileges). Conditional: plain
--      Postgres (local dev, CI, on-prem) has no such roles.
--   2. Enable RLS on the nine tables with a policy admitting every role
--      EXCEPT the API roles, so the app keeps working unchanged whatever
--      database user it connects as, and a future accidental GRANT to an API
--      role still yields zero rows. NOT forced: the owner (migration runner)
--      keeps direct access. schema_migrations gets no policy at all — only
--      its owner, the migration runner, ever touches it.
--
-- Also recommended in the Supabase dashboard (not expressible in SQL here):
-- turn off the Data API, or remove `public` from its exposed schemas.
BEGIN;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      -- Future objects created by the role running this migration.
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants', 'users', 'sessions', 'password_resets', 'login_attempts',
    'invitations', 'super_admins', 'super_admin_sessions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY not_api_roles ON %I USING (current_user NOT IN (''anon'', ''authenticated'')) '
      'WITH CHECK (current_user NOT IN (''anon'', ''authenticated''))', t);
  END LOOP;
END $$;

ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

COMMIT;
