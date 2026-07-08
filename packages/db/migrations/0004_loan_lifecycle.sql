-- 0004_loan_lifecycle.sql — applications, approvals, loans, schedules,
-- repayments, disbursements. Same pattern as 0001-0003: every table
-- tenant_id NOT NULL, FORCED RLS, composite index led by tenant_id.
-- Composite FKs (tenant_id, parent_id) enforce same-tenant references
-- so a child can never point at another tenant's parent.

BEGIN;

-- Composite unique keys on existing parents so children can FK to
-- (tenant_id, id) and inherit same-tenant enforcement.
ALTER TABLE loan_products ADD CONSTRAINT loan_products_tenant_id_key UNIQUE (tenant_id, id);
ALTER TABLE employees     ADD CONSTRAINT employees_tenant_id_key     UNIQUE (tenant_id, id);

-- ---------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------
CREATE TABLE loan_applications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL,
  loan_product_id uuid NOT NULL,
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  tenor_months    int NOT NULL CHECK (tenor_months > 0),
  purpose         text,
  declared_external_loans jsonb NOT NULL DEFAULT '[]'::jsonb,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','submitted','in_review','approved','rejected','withdrawn')),
  -- inputs + eligibility result frozen at submission, so later rule
  -- changes don't retroactively alter a decided application
  eligibility_snapshot jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, employee_id)     REFERENCES employees (tenant_id, id),
  FOREIGN KEY (tenant_id, loan_product_id) REFERENCES loan_products (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX loan_applications_tenant_idx ON loan_applications (tenant_id, status);

-- ---------------------------------------------------------------
-- Approvals (one row per approver decision on an application)
-- ---------------------------------------------------------------
CREATE TABLE approvals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  application_id  uuid NOT NULL,
  stage_id        uuid REFERENCES approval_stages(id),
  approver_user_id uuid REFERENCES users(id),
  decision        text NOT NULL CHECK (decision IN ('pending','approved','rejected','delegated')),
  comment         text,
  delegated_from  uuid REFERENCES users(id),
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, application_id) REFERENCES loan_applications (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX approvals_tenant_idx ON approvals (tenant_id, application_id);

-- ---------------------------------------------------------------
-- Loans (created when an application is fully approved)
-- ---------------------------------------------------------------
CREATE TABLE loans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  application_id  uuid NOT NULL,
  principal       numeric(14,2) NOT NULL CHECK (principal > 0),
  annual_rate     numeric(6,3) NOT NULL CHECK (annual_rate >= 0),
  rate_mode       text NOT NULL CHECK (rate_mode IN ('fixed','index_plus_margin')),
  start_date      date NOT NULL,
  tenor_months    int NOT NULL CHECK (tenor_months > 0),
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','settled','restructured','written_off')),
  asset_details   jsonb,  -- vehicle/land info for asset loans
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, application_id) REFERENCES loan_applications (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX loans_tenant_idx ON loans (tenant_id, status);

-- ---------------------------------------------------------------
-- Schedules (versioned; new version on restructure/top-up)
-- ---------------------------------------------------------------
CREATE TABLE loan_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  loan_id         uuid NOT NULL,
  version         int NOT NULL DEFAULT 1,
  engine_version  text NOT NULL,  -- which amortization engine produced this
  generated_at    timestamptz NOT NULL DEFAULT now(),
  is_active       boolean NOT NULL DEFAULT true,
  FOREIGN KEY (tenant_id, loan_id) REFERENCES loans (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, loan_id, version)
);
CREATE INDEX loan_schedules_tenant_idx ON loan_schedules (tenant_id, loan_id);

CREATE TABLE schedule_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  schedule_id     uuid NOT NULL,
  period_no       int NOT NULL CHECK (period_no > 0),
  due_date        date NOT NULL,
  opening_balance numeric(14,2) NOT NULL,
  principal_due   numeric(14,2) NOT NULL,
  interest_due    numeric(14,2) NOT NULL,
  instalment      numeric(14,2) NOT NULL,
  -- floored at zero — carries the early-settlement fix from the Excel model
  closing_balance numeric(14,2) NOT NULL CHECK (closing_balance >= 0),
  FOREIGN KEY (tenant_id, schedule_id) REFERENCES loan_schedules (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, schedule_id, period_no)
);
CREATE INDEX schedule_lines_tenant_idx ON schedule_lines (tenant_id, schedule_id, period_no);

-- ---------------------------------------------------------------
-- Repayments & disbursements
-- ---------------------------------------------------------------
CREATE TABLE repayments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  loan_id         uuid NOT NULL,
  source          text NOT NULL CHECK (source IN ('payroll','manual','early')),
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  value_date      date NOT NULL,
  allocation      jsonb,  -- {interest: x, principal: y} split
  posted_by       uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, loan_id) REFERENCES loans (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX repayments_tenant_idx ON repayments (tenant_id, loan_id, value_date);

CREATE TABLE disbursements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  loan_id         uuid NOT NULL,
  method          text NOT NULL CHECK (method IN ('to_employee','to_vendor')),
  payee           jsonb,  -- vendor/employee bank details
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  reference       text,
  disbursed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, loan_id) REFERENCES loans (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX disbursements_tenant_idx ON disbursements (tenant_id, loan_id);

-- ---------------------------------------------------------------
-- RLS: enable + FORCE on every new table
-- ---------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['loan_applications','approvals','loans','loan_schedules','schedule_lines','repayments','disbursements']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wola_app', t);
  END LOOP;
END $$;

COMMIT;