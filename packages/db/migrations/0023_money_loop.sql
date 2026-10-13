-- 0023_money_loop.sql — closing the money loop: one definition of "outstanding",
-- payroll runs, payment holidays, and early-repayment requests.
--
-- All additive and backward compatible with the previous release's code.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ONE definition of a loan's outstanding balance.
--
-- Outstanding = principal - principal repaid to date, where "principal repaid" is
-- the principal portion of each repayment's allocation (the ledger). Eight places
-- used to compute this with their own copy of the SQL (book, my loans, reports x2,
-- dashboard metrics x2, super-admin, and loanOutstanding()); a copy that drifts
-- shows two different numbers for one loan. They now all read this view.
--
-- security_invoker: the view runs with the CALLER's privileges, so the forced
-- tenant row-level security on loans and repayments still applies; it can never
-- show another tenant's balances.
-- ---------------------------------------------------------------------------
CREATE VIEW loan_balances WITH (security_invoker = true) AS
SELECT
  l.tenant_id,
  l.id        AS loan_id,
  l.principal,
  COALESCE(sum((r.allocation->>'principal')::numeric), 0)                         AS principal_repaid,
  GREATEST(l.principal - COALESCE(sum((r.allocation->>'principal')::numeric), 0), 0) AS outstanding
FROM loans l
LEFT JOIN repayments r ON r.tenant_id = l.tenant_id AND r.loan_id = l.id
GROUP BY l.tenant_id, l.id, l.principal;

GRANT SELECT ON loan_balances TO wola_app;

-- ---------------------------------------------------------------------------
-- 2. Payroll runs: one action that records a cycle's deductions, so the total
-- posted is a single auditable figure that ties out to its repayments.
-- ---------------------------------------------------------------------------
CREATE TABLE payroll_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cycle          text NOT NULL CHECK (cycle ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  -- 'bulk': posted the expected deduction for every loan that was due;
  -- 'import': posted the actuals from the payroll file.
  kind           text NOT NULL CHECK (kind IN ('bulk', 'import')),
  loan_count     integer NOT NULL CHECK (loan_count >= 0),
  expected_total numeric(14,2) NOT NULL,
  posted_total   numeric(14,2) NOT NULL,
  note           text,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX payroll_runs_tenant_idx ON payroll_runs (tenant_id, cycle, created_at);

ALTER TABLE repayments ADD COLUMN payroll_run_id uuid;
ALTER TABLE repayments ADD CONSTRAINT repayments_payroll_run_fk
  FOREIGN KEY (tenant_id, payroll_run_id) REFERENCES payroll_runs (tenant_id, id);
CREATE INDEX repayments_run_idx ON repayments (tenant_id, payroll_run_id) WHERE payroll_run_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Payment holidays, as EVENTS. No schedule rows are replaced: each line gets an
-- effective due date from these windows (see packages/engine/src/suspension.ts).
-- ---------------------------------------------------------------------------
CREATE TABLE loan_suspensions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  loan_id    uuid NOT NULL,
  from_date  date NOT NULL,
  to_date    date NOT NULL,
  reason     text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A mistaken holiday is cancelled, never deleted: the record stays, and the
  -- schedule simply stops applying it.
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES users(id),
  -- A holiday is whole calendar months, at most a year.
  CHECK (to_date >= from_date AND to_date <= from_date + interval '1 year'),
  FOREIGN KEY (tenant_id, loan_id) REFERENCES loans (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX loan_suspensions_tenant_idx ON loan_suspensions (tenant_id, loan_id, from_date);

-- ---------------------------------------------------------------------------
-- 4. Early-repayment requests (an employee asks to pay a lump sum or the whole
-- balance; finance records the money when it arrives). Also used when an employee
-- leaves and the organisation's policy is to recover the balance.
-- ---------------------------------------------------------------------------
CREATE TABLE early_repayment_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  loan_id        uuid NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('full', 'partial')),
  -- partial: the lump sum asked for. full: NULL (the payoff is worked out when recorded).
  amount         numeric(14,2) CHECK (amount IS NULL OR amount > 0),
  quoted_payoff  numeric(14,2) NOT NULL,
  reason         text,
  status         text NOT NULL DEFAULT 'requested'
                 CHECK (status IN ('requested', 'paid', 'declined', 'cancelled')),
  requested_by   uuid REFERENCES users(id),
  decided_by     uuid REFERENCES users(id),
  decided_at     timestamptz,
  decision_note  text,
  repayment_id   uuid REFERENCES repayments(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'partial') = (amount IS NOT NULL)),
  FOREIGN KEY (tenant_id, loan_id) REFERENCES loans (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX early_repayment_tenant_idx ON early_repayment_requests (tenant_id, status, created_at);
-- One open request per loan.
CREATE UNIQUE INDEX early_repayment_one_open ON early_repayment_requests (tenant_id, loan_id) WHERE status = 'requested';

-- ---------------------------------------------------------------------------
-- Row-level security on every new tenant table (README non-negotiable #2).
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_runs', 'loan_suspensions', 'early_repayment_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wola_app', t);
  END LOOP;
END $$;

-- History is append-only for the runtime role: payroll runs can be added but never
-- changed or removed; suspensions can be cancelled (UPDATE) but never deleted;
-- early-repayment requests change status (UPDATE) but are never deleted.
REVOKE UPDATE, DELETE ON payroll_runs FROM wola_app;
REVOKE DELETE ON loan_suspensions FROM wola_app;
REVOKE DELETE ON early_repayment_requests FROM wola_app;

COMMIT;
