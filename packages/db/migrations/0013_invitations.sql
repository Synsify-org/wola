-- 0013_invitations.sql — invite-based account provisioning (spec §7.4).
-- Replaces the temp-password stopgap in employees-actions.ts's
-- createAccountAction (relay-a-password-out-of-band, effectively permanent
-- until now). Same shape as password_resets (0012): looked up by a bare
-- token before any tenant context is guaranteed, so NOT under RLS — the
-- unguessable token_hash is the security boundary. Creation still happens
-- inside the inviter's tenantTx, which is what ties an invite to a tenant.
BEGIN;

CREATE TABLE invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Optional link to an existing employee row awaiting a login. Null for an
  -- invite with no employee record (e.g. a pure org_admin/auditor account).
  employee_id  uuid,
  email        citext NOT NULL,
  role         text NOT NULL CHECK (role IN
    ('employee','dept_head','hr','cfo','ceo','coo','group_ceo','org_admin','auditor')),
  token_hash   text NOT NULL UNIQUE,
  invited_by   uuid REFERENCES users(id),
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Composite FK enforces the employee belongs to the SAME tenant as the
  -- invite; satisfied trivially when employee_id is null.
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX invitations_token_idx  ON invitations (token_hash);
CREATE INDEX invitations_tenant_idx ON invitations (tenant_id, email);

GRANT SELECT, INSERT, UPDATE ON invitations TO wola_app;

COMMIT;
