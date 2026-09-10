-- 0014_super_admin.sql — the super-admin surface (spec §6.1).
-- Reuses the SAME global users/password identity every tenant user has (the
-- architecture doc's own correction: no separate hardcoded credentials, no
-- parallel auth system). super_admins is just a flag table saying "this
-- global user is also a platform operator" — a person can be both a tenant
-- member (their own company) and a super-admin, orthogonally.
--
-- super_admin_sessions mirrors sessions (0003) exactly, minus tenant_id — a
-- super-admin session isn't pinned to any one tenant. Same reasoning as
-- sessions/password_resets: looked up by bare token, so NOT under RLS; the
-- unguessable token_hash is the security boundary.
BEGIN;

CREATE TABLE super_admins (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE super_admin_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX super_admin_sessions_token_idx ON super_admin_sessions (token_hash);

GRANT SELECT, INSERT, UPDATE ON super_admins TO wola_app;
GRANT SELECT, INSERT, DELETE ON super_admin_sessions TO wola_app;

COMMIT;
