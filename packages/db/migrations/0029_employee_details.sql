-- 0029_employee_details.sql — two things an organisation's HR needs to fill in after the staff list is loaded.
--
-- work_email   the address the person's invitation goes to. Entered by HR or an administrator
--              (the client's staff list rarely has it), used by "Invite many people".
-- review_note  why a record needs a person to look at it: set when the list was loaded
--              (for example "line manager 'X' matches nobody") and cleared by HR when settled.
--              Shown on the HR dashboard until then.
-- Additive: the previous version of the app ignores both columns.
BEGIN;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS work_email  citext CHECK (work_email IS NULL OR length(work_email) <= 254),
  ADD COLUMN IF NOT EXISTS review_note text   CHECK (review_note IS NULL OR length(review_note) <= 500);

COMMIT;
