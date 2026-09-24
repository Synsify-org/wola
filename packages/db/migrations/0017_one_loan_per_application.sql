-- 0017_one_loan_per_application.sql — make "one loan per application" a
-- database guarantee, not just an application-level check.
-- createLoanFromApplication (loans.ts) SELECTs for an existing loan and then
-- INSERTs; two concurrent final approvals could both pass that check. 0015's
-- one-decision-per-stage constraint already closes the known path, but the
-- loan table itself should refuse a duplicate regardless of how it's reached
-- (a future script, a retry, a second code path). Same belt-and-braces
-- reasoning as 0015/0016.
--
-- Safe to add: every code path creates at most one loan per application, and
-- the constraint will fail loudly here if any duplicate already exists —
-- resolve those by hand before re-running rather than dropping data.
--
-- Deliberately NOT added: UNIQUE (loan_id) on disbursements. The method enum
-- ('to_employee' | 'to_vendor') leaves room for split pay-outs later;
-- disburseLoan's FOR UPDATE row lock is what prevents a double disbursement.
BEGIN;

ALTER TABLE loans
  ADD CONSTRAINT loans_one_per_application UNIQUE (tenant_id, application_id);

COMMIT;
