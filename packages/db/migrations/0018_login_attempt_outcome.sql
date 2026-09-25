-- 0018_login_attempt_outcome.sql — record whether each login attempt
-- succeeded, so rate limits can count FAILURES only.
--
-- Two limits read this table (packages/db/src/auth.ts isRateLimited):
--   - per (email, ip): stops brute-forcing one account;
--   - per ip, across all emails: stops password spraying (one machine
--     trying one password against many accounts), which the pair limit
--     alone never catches.
-- The per-IP limit MUST ignore successes: a whole office signs in from one
-- NAT'd public IP every morning, and counting those would lock the office
-- out. Counting only failures on both limits also stops a user who signs in
-- and out a few times from tripping the pair limit.
--
-- Existing rows default to succeeded = false (the conservative reading);
-- they age out of every 15-minute window within minutes anyway.
BEGIN;

ALTER TABLE login_attempts
  ADD COLUMN succeeded boolean NOT NULL DEFAULT false;

-- Serves the per-IP failure count. The existing (email, ip, created_at)
-- index keeps serving the pair count.
CREATE INDEX login_attempts_ip_failures_idx
  ON login_attempts (ip, created_at) WHERE NOT succeeded;

COMMIT;
