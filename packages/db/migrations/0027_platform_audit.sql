-- 0027_platform_audit.sql — an audit trail for the platform console itself.
--
-- The per-organisation audit log records what happens INSIDE an organisation. It cannot
-- record what a Wola operator does ABOUT organisations: signing in, enrolling their
-- second factor, opening an organisation's details. Those events belong to the platform,
-- not to any one tenant, so they get their own table.
--
-- A global table (no tenant rules), like users and sessions, so it gets the same Data API
-- lockout (migration 0019): RLS with a policy that admits every role except Supabase's
-- anon/authenticated. Append-only for the runtime role: events can be added and read,
-- never changed or removed.
BEGIN;

CREATE TABLE platform_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Who. The email is copied so the record still reads right if the account is later removed.
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_email text,
  -- What, e.g. 'platform.signed_in', 'platform.mfa_enrolled', 'platform.viewed_tenant'.
  action      text NOT NULL CHECK (length(btrim(action)) BETWEEN 1 AND 80),
  -- Which organisation it concerned, when it concerned one.
  tenant_id   uuid REFERENCES tenants(id) ON DELETE SET NULL,
  detail      jsonb,
  ip          text,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_audit_at_idx     ON platform_audit_log (at DESC);
CREATE INDEX platform_audit_tenant_idx ON platform_audit_log (tenant_id, at DESC);

GRANT SELECT, INSERT ON platform_audit_log TO wola_app;

ALTER TABLE platform_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY not_api_roles ON platform_audit_log
  USING (current_user NOT IN ('anon', 'authenticated'))
  WITH CHECK (current_user NOT IN ('anon', 'authenticated'));

COMMIT;
