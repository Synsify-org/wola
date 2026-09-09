-- 0011_email_outbox.sql
-- Durable, retryable email queue (Tier 1.1 — WOLA_BUILD_SPEC.md Feature 1.1).
-- Application code NEVER sends an email inline with a request; it enqueues a
-- row here inside the same tenantTx as whatever triggered it, and a separate
-- delivery process (scripts/process-email-outbox.mjs) attempts the actual
-- send. Same tenant-table pattern as everything else: FORCED RLS, composite
-- index led by tenant_id.
BEGIN;

CREATE TABLE email_outbox (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  to_email    citext NOT NULL,
  subject     text NOT NULL,
  body_html   text NOT NULL,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'sent', 'failed')),
  attempts    int NOT NULL DEFAULT 0,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE INDEX email_outbox_tenant_idx ON email_outbox (tenant_id, status, created_at);

ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_outbox FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON email_outbox
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- wola_app enqueues (INSERT) and the app never marks its own mail sent —
-- delivery status is written by the outbox processor. Both need to happen
-- inside the normal RLS-scoped connection (enqueue) or the admin connection
-- (cross-tenant delivery sweep, see the script) — never a third path.
GRANT SELECT, INSERT, UPDATE ON email_outbox TO wola_app;

COMMIT;
