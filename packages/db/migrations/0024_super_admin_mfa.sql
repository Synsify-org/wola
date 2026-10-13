-- 0024_super_admin_mfa.sql — two-step sign-in for the platform (super) admin.
--
-- The platform console can see every organisation, so its sign-in is the one that
-- most needs a second factor. The machinery is the same as for tenant users
-- (user_mfa, recovery codes, challenges); what changes:
--   * a challenge may belong to the platform instead of a tenant (tenant_id NULL);
--   * a platform session records WHEN its second factor was proven. Until it is
--     set, the session can reach only the setup page.
-- Additive: existing sessions simply read as "not verified" and are asked once.
BEGIN;

ALTER TABLE mfa_challenges ALTER COLUMN tenant_id DROP NOT NULL;

ALTER TABLE super_admin_sessions ADD COLUMN mfa_verified_at timestamptz;
GRANT UPDATE ON super_admin_sessions TO wola_app;

COMMIT;
