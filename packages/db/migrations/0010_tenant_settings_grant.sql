-- 0010_tenant_settings_grant.sql
-- White-label theming writes brand colours/font into tenants.settings. The app
-- role wola_app is otherwise READ-ONLY on tenants (GRANT SELECT, migration
-- 0001) by design — it must not change slug, status, plan, etc. This grants a
-- COLUMN-SCOPED update on settings ONLY, mirroring the password_hash pattern in
-- 0003 (GRANT UPDATE (password_hash) ON users). The admin-role check lives in
-- the application (saveThemeAction); this grant just lets that write reach the
-- one column it needs.
GRANT UPDATE (settings) ON tenants TO wola_app;