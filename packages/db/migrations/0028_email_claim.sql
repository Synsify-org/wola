-- 0028_email_claim.sql
-- Sending email from inside the app (see deliverTenantEmails in email.ts).
-- A request claims a batch of one organisation's waiting mail for a few minutes ("a lease"), so
-- two requests happening at once never send the same email twice. claimed_at is that lease:
-- empty = free to claim. Additive: the previous version of the app ignores the column.
BEGIN;

ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

COMMIT;
