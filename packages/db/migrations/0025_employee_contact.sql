-- 0025_employee_contact.sql — optional contact details on an employee's own record.
--
-- Phone and location are what finance needs to reach someone about a loan. Both are
-- optional, editable by the person themselves (Settings -> Your details) and by HR.
-- Deliberately NOT here: national ID, date of birth, address documents. Identity
-- verification (KYC) is a policy and data-protection decision, see
-- docs/business/POLICY_DECISIONS.md.
BEGIN;

ALTER TABLE employees
  ADD COLUMN phone text CHECK (phone IS NULL OR length(phone) <= 32),
  ADD COLUMN location text CHECK (location IS NULL OR length(location) <= 120);

COMMIT;
