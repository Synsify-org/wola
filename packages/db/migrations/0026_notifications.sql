-- 0026_notifications.sql — in-app notifications (the bell in the top bar).
--
-- One row per person per event: "Awaiting your decision", "Your loan was approved",
-- "A request to repay early needs recording". They are created by the same code that
-- already sends the email for that event, inside the same transaction, so an event and
-- its notification commit or roll back together.
--
-- Tenant-isolated like every other tenant table (forced row-level security). The app
-- additionally always filters by the signed-in person's user id, so someone never sees
-- a colleague's notifications. The runtime role can add and mark-read but never delete:
-- notifications are history, and old ones are trimmed by a maintenance job, not by users.
BEGIN;

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  -- A short machine-readable type, e.g. 'application.awaiting'. Free text on purpose: new
  -- events need no migration.
  kind       text NOT NULL CHECK (length(btrim(kind)) BETWEEN 1 AND 60),
  title      text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  body       text CHECK (body IS NULL OR length(body) <= 500),
  -- Where clicking it goes. In-app paths only ('/loans/…'), never an external URL, so a
  -- notification can't be used to send someone off to another site. (A second '/' or a
  -- backslash after the first '/' would be read by browsers as another host.)
  href       text CHECK (href IS NULL OR href = '/' OR (href LIKE '/%' AND substr(href, 2, 1) NOT IN ('/', chr(92)))),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);

CREATE INDEX notifications_user_idx   ON notifications (tenant_id, user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (tenant_id, user_id) WHERE read_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON notifications TO wola_app;

COMMIT;
