-- 0003_auth.sql — password auth + tenant-pinned sessions
BEGIN;

-- One identity, one password (Slack-style). Authorization is per-tenant
-- via memberships. NULL allowed so existing seed users don't break;
-- login rejects NULL-hash users.
ALTER TABLE users ADD COLUMN password_hash text;

-- Sessions pin BOTH the user and the tenant they authenticated into.
-- A session for tenant A is meaningless on tenant B's subdomain.
CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- store only a HASH of the session token, never the token itself,
  -- so a DB leak can't be replayed as a live session.
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id, token_hash)
);
CREATE INDEX sessions_token_idx  ON sessions (token_hash);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

-- sessions are looked up by token BEFORE a tenant context exists
-- (that's how we discover the tenant), so this table is NOT under RLS.
-- Its security comes from the unguessable token_hash, not tenant scoping.
GRANT SELECT, INSERT, DELETE ON sessions TO wola_app;
GRANT SELECT, UPDATE (password_hash) ON users TO wola_app;

COMMIT;