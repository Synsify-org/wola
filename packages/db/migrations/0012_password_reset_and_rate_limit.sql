-- 0012_password_reset_and_rate_limit.sql — Tier 1.2 auth hardening.
BEGIN;

-- Password reset tokens. Same security shape as `sessions` (migration
-- 0003): only a HASH of the token is stored, single-use (used_at), time-
-- limited. Not tenant-scoped / not under RLS for the same reason sessions
-- isn't — looked up by token before any tenant context exists, and its
-- security comes from the unguessable token_hash, not RLS.
CREATE TABLE password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_token_idx ON password_resets (token_hash);

-- Login attempt log for rate limiting (5 attempts / 15 min / email+IP).
-- Deliberately global, not tenant-scoped: an attacker probing one email
-- across many tenant subdomains should still hit the same limit. Rows are
-- cheap and short-lived in practice (only the last 15 minutes matter for
-- the check); a periodic cleanup is a fine follow-up, not required for
-- correctness since old rows just age out of every query's WHERE clause.
CREATE TABLE login_attempts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       citext NOT NULL,
  ip          text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_lookup_idx ON login_attempts (email, ip, created_at);

GRANT SELECT, INSERT, UPDATE ON password_resets TO wola_app;
GRANT SELECT, INSERT ON login_attempts TO wola_app;

COMMIT;
