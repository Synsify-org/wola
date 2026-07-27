-- 0009_loan_pending_disbursement.sql
-- Approval is not disbursement. A loan created by a final approval has not
-- been paid out: finance moves the money separately (disbursements table).
-- Without this state, every approved loan is instantly 'active' and the book
-- shows exposure the employer has not actually lent. An accounting defect no
-- SACCO would accept.
BEGIN;

ALTER TABLE loans DROP CONSTRAINT loans_status_check;
ALTER TABLE loans ADD CONSTRAINT loans_status_check
  CHECK (status IN ('pending_disbursement','active','settled','restructured','written_off'));

ALTER TABLE loans ALTER COLUMN status SET DEFAULT 'pending_disbursement';

-- Approved applications become loans. 'approved' remains the terminal
-- application state; the loan row carries the lifecycle from here.
COMMIT;