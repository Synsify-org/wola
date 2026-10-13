-- 0022_mfa.sql — two-step sign-in (TOTP authenticator apps) with recovery codes.
--
-- MFA belongs to the global user identity (one Wola login can span
-- organisations), exactly like users / sessions, so these tables sit OUTSIDE
-- tenant RLS. They get the same Supabase Data API lockout as the other global
-- tables (migration 0019): RLS enabled with a policy that admits every role
-- except the API roles.
--
--   user_mfa            the user's authenticator secret, ENCRYPTED by the app
--                       (AES-256-GCM, key in MFA_ENCRYPTION_KEY, never in the
--                       database). enabled_at stays NULL until the user proves
--                       they can produce a code. last_used_step blocks replay of
--                       a code within its 30s window.
--   mfa_recovery_codes  one-time codes for a lost phone; only a hash is kept.
--   mfa_challenges      the short-lived step between "password OK" and "code
--                       OK". No session exists until the code is accepted. Pins
--                       the tenant, expires in minutes, and caps wrong guesses.
--
-- Whether an organisation REQUIRES two-step sign-in for some roles lives in
-- tenants.settings.security (no schema change).
BEGIN;

CREATE TABLE user_mfa (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_enc     text NOT NULL,
  enabled_at     timestamptz,
  last_used_step bigint,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mfa_recovery_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)
);
CREATE INDEX mfa_recovery_codes_user_idx ON mfa_recovery_codes (user_id);

CREATE TABLE mfa_challenges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  remember   boolean NOT NULL DEFAULT false,
  attempts   int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_challenges_expiry_idx ON mfa_challenges (expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON user_mfa, mfa_recovery_codes, mfa_challenges TO wola_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_mfa', 'mfa_recovery_codes', 'mfa_challenges'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY not_api_roles ON %I USING (current_user NOT IN (''anon'', ''authenticated'')) '
      'WITH CHECK (current_user NOT IN (''anon'', ''authenticated''))', t);
  END LOOP;
END $$;

COMMIT;
