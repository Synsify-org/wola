-- 0002_config_layer.sql — tenant-configurable loan products & approvals
-- Same pattern as 0001: every table tenant_id NOT NULL, FORCED RLS,
-- composite index led by tenant_id, policy with USING + WITH CHECK.

BEGIN;

-- ---------------------------------------------------------------
-- Rate indices (e.g. BoU CBR) — referenced by product rules
-- ---------------------------------------------------------------
CREATE TABLE rate_indices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           text NOT NULL,
  current_value  numeric(6,3) NOT NULL CHECK (current_value >= 0),
  effective_from date NOT NULL DEFAULT current_date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name, effective_from)
);
CREATE INDEX rate_indices_tenant_idx ON rate_indices (tenant_id, name);

-- ---------------------------------------------------------------
-- Loan products — the configurable heart of the product
-- ---------------------------------------------------------------
CREATE TABLE loan_products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('advance','term','asset')),
  -- rules jsonb holds cap formula, max tenor, interest mode
  -- (fixed | index+margin), rounding, concurrency restrictions.
  rules        jsonb NOT NULL DEFAULT '{}'::jsonb,
  rate_index_id uuid REFERENCES rate_indices(id),
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE INDEX loan_products_tenant_idx ON loan_products (tenant_id, active);

-- ---------------------------------------------------------------
-- Approval pipelines & stages
-- ---------------------------------------------------------------
CREATE TABLE approval_pipelines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  loan_product_id uuid NOT NULL REFERENCES loan_products(id) ON DELETE CASCADE,
  -- 'default' or a role name, so the CEO-applicant special pipeline
  -- can differ from the standard one.
  applies_to      text NOT NULL DEFAULT 'default',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, loan_product_id, applies_to)
);
CREATE INDEX approval_pipelines_tenant_idx ON approval_pipelines (tenant_id, loan_product_id);

CREATE TABLE approval_stages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pipeline_id     uuid NOT NULL REFERENCES approval_pipelines(id) ON DELETE CASCADE,
  position        int  NOT NULL CHECK (position > 0),
  approver_role   text NOT NULL CHECK (approver_role IN
    ('dept_head','hr','cfo','ceo','coo','group_ceo','org_admin')),
  sla_hours       int  CHECK (sla_hours IS NULL OR sla_hours > 0),
  allow_delegation boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, pipeline_id, position)
);
CREATE INDEX approval_stages_tenant_idx ON approval_stages (tenant_id, pipeline_id, position);

-- ---------------------------------------------------------------
-- RLS: enable + FORCE on every new table
-- ---------------------------------------------------------------
ALTER TABLE rate_indices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_indices        FORCE  ROW LEVEL SECURITY;
ALTER TABLE loan_products       ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_products       FORCE  ROW LEVEL SECURITY;
ALTER TABLE approval_pipelines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_pipelines  FORCE  ROW LEVEL SECURITY;
ALTER TABLE approval_stages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_stages     FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON rate_indices
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON loan_products
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON approval_pipelines
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON approval_stages
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------
-- Runtime grants (app role: DML only, no DDL)
-- ---------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  rate_indices, loan_products, approval_pipelines, approval_stages TO wola_app;

COMMIT;