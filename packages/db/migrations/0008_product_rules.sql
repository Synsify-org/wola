-- 0008_product_rules.sql
-- Eligibility rules become TENANT CONFIG, not code.
--
-- Until now the engine hardcoded MUA''s benefit scheme (1x gross advance,
-- 3x gross development, 40% x take-home x 30 car). That made Wola a bespoke
-- MUA system wearing a SaaS costume: a SACCO with a 4x-net development loan
-- could not use it without a code change and a redeploy.
--
-- These columns are the same move already made for approval pipelines: the
-- customer''s policy is DATA. MUA is one row. A SACCO is another.
BEGIN;

ALTER TABLE loan_products
  -- How the ceiling is computed. Two shapes cover every scheme seen so far:
  --   'salary_multiple' : basis x multiple          (advance, development)
  --   'takehome_factor' : (net - recoveries) x factor x multiplier   (car)
  ADD COLUMN cap_method text NOT NULL DEFAULT 'salary_multiple'
    CHECK (cap_method IN ('salary_multiple', 'takehome_factor')),

  -- Which salary figure the cap is measured against.
  ADD COLUMN cap_basis text NOT NULL DEFAULT 'gross'
    CHECK (cap_basis IN ('gross', 'net')),

  -- salary_multiple: cap = basis x cap_multiple
  ADD COLUMN cap_multiple numeric(10,4),

  -- takehome_factor: cap = (net - internal - external) x factor x multiplier
  ADD COLUMN takehome_factor numeric(6,4),
  ADD COLUMN takehome_multiplier numeric(10,4),

  -- Tenor and pricing.
  ADD COLUMN max_tenor_months integer NOT NULL DEFAULT 36
    CHECK (max_tenor_months > 0),
  ADD COLUMN interest_applies boolean NOT NULL DEFAULT true,

  -- Universal gates. Every scheme so far has these, but a tenant may not.
  ADD COLUMN requires_post_probation boolean NOT NULL DEFAULT true,
  ADD COLUMN blocked_by_final_warning boolean NOT NULL DEFAULT true,

  -- Must the applicant declare outside borrowings? (MUA: car loan only.)
  ADD COLUMN requires_external_declaration boolean NOT NULL DEFAULT false;

-- Products that cannot run concurrently. Symmetric by convention: MUA bars
-- car + development together, but allows an advance alongside either.
CREATE TABLE product_exclusions (
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  loan_product_id     uuid NOT NULL,
  excludes_product_id uuid NOT NULL,
  reason              text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (loan_product_id, excludes_product_id),
  FOREIGN KEY (tenant_id, loan_product_id)
    REFERENCES loan_products (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, excludes_product_id)
    REFERENCES loan_products (tenant_id, id) ON DELETE CASCADE,
  CHECK (loan_product_id <> excludes_product_id)
);

ALTER TABLE product_exclusions ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_exclusions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_exclusions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON product_exclusions TO wola_app;

CREATE INDEX product_exclusions_tenant_idx
  ON product_exclusions (tenant_id, loan_product_id);

COMMIT;
