-- 0016_prevent_duplicate_applications.sql — one in-flight application per
-- employee per product. Reported bug: an employee could submit N
-- applications for the same product while an earlier one was still
-- 'submitted'/'in_review' — nothing checked loan_applications at all before
-- inserting (only employees.active_product_ids, populated from ACTIVE
-- LOANS, which an in-flight application obviously isn't yet).
--
-- Partial unique index, not a full one: an employee CAN legitimately have
-- many historical applications for the same product (approved, rejected,
-- withdrawn) — only one may be actively in flight at a time.
BEGIN;

-- Clean up existing violations before the constraint can be added — this
-- bug already produced duplicate in-flight applications (confirmed:
-- applying this migration against real data failed on a genuine
-- duplicate). Keep the most recent one per (employee, product) as the
-- live application; withdraw the older, now-superseded duplicates rather
-- than silently deleting them.
UPDATE loan_applications la SET status = 'withdrawn', updated_at = now()
WHERE la.status IN ('submitted', 'in_review')
  AND la.id <> (
    SELECT id FROM loan_applications la2
    WHERE la2.employee_id = la.employee_id
      AND la2.loan_product_id = la.loan_product_id
      AND la2.status IN ('submitted', 'in_review')
    ORDER BY la2.created_at DESC
    LIMIT 1
  );

CREATE UNIQUE INDEX loan_applications_one_in_flight_per_product
  ON loan_applications (employee_id, loan_product_id)
  WHERE status IN ('submitted', 'in_review');

COMMIT;
