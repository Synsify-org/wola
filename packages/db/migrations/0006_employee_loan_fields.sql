-- 0006_employee_loan_fields.sql — fields the eligibility engine and the
-- personalized application form need, per the MUA benefit scheme + spec.
BEGIN;

ALTER TABLE employees
  ADD COLUMN title text,
  ADD COLUMN department_head text,
  -- benefit scheme: all loans require post-probation
  ADD COLUMN is_post_probation boolean NOT NULL DEFAULT false,
  -- spec: people on a final warning letter cannot apply for any loan
  ADD COLUMN on_final_warning boolean NOT NULL DEFAULT false;

COMMIT;