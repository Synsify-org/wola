-- 0001_init.sql — Wola tenant foundation
-- Runs as wola_admin (owner). The application connects as wola_app,
-- which has no BYPASSRLS and no DDL. RLS is FORCED so even table
-- owners cannot skip it accidentally.

BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------
CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        citext NOT NULL UNIQUE,
  name        text   NOT NULL,
  status      text   NOT NULL DEFAULT 'trial'
              CHECK (status IN ('trial','active','suspended','closed')),
  plan        text   NOT NULL DEFAULT 'standard',
  currency    char(3) NOT NULL DEFAULT 'UGX',
  timezone    text   NOT NULL DEFAULT 'Africa/Kampala',
  settings    jsonb  NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- slug is the subdomain: lowercase, digits, hyphens, 2-31 chars
  CONSTRAINT slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,30}$'),
  -- reserved words can never become tenant subdomains
  CONSTRAINT slug_reserved CHECK (slug NOT IN
    ('www','app','api','admin','docs','status','mail','staging',
     'assets','cdn','auth','billing','support','demo'))
);

-- Helper: the current tenant from the transaction-local setting.
-- Returns NULL when no context is set -> every policy evaluates false.
CREATE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- ---------------------------------------------------------------
-- Identity (users are global; membership binds them to a tenant)
-- ---------------------------------------------------------------
CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       citext NOT NULL UNIQUE,
  name        text   NOT NULL,
  status      text   NOT NULL DEFAULT 'active'
              CHECK (status IN ('active','disabled')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN
    ('employee','dept_head','hr','cfo','ceo','coo','group_ceo',
     'org_admin','auditor')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, role)
);
CREATE INDEX memberships_tenant_idx ON memberships (tenant_id, user_id);

-- ---------------------------------------------------------------
-- First business table (pattern for every future tenant table)
-- ---------------------------------------------------------------
CREATE TABLE employees (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id),
  employee_no   text NOT NULL,
  full_name     text NOT NULL,
  department    text,
  gross_salary  numeric(14,2) NOT NULL CHECK (gross_salary >= 0),
  net_salary    numeric(14,2) NOT NULL CHECK (net_salary >= 0),
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','exited','suspended')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_no)
);
CREATE INDEX employees_tenant_idx ON employees (tenant_id, status);

-- ---------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------
CREATE TABLE audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  actor_id    uuid,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_tenant_at_idx ON audit_log (tenant_id, at DESC);

-- ---------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE  ROW LEVEL SECURITY;
ALTER TABLE employees   ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees   FORCE  ROW LEVEL SECURITY;
ALTER TABLE audit_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log   FORCE  ROW LEVEL SECURITY;

-- One policy per table: rows visible AND writable only inside the
-- matching tenant context. WITH CHECK blocks cross-tenant inserts.
CREATE POLICY tenant_isolation ON memberships
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON employees
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON audit_log
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------
-- Grants for the runtime role
-- ---------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO wola_app;
-- tenants: lookup table for subdomain resolution (read-only to app)
GRANT SELECT ON tenants TO wola_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, memberships, employees TO wola_app;
-- audit log is append-only: no UPDATE, no DELETE, for anyone at runtime
GRANT SELECT, INSERT ON audit_log TO wola_app;

COMMIT;
