-- 0005_lifecycle_cascades.sql — add ON DELETE CASCADE to the composite
-- FKs from 0004. Without this, deleting an employee/product is blocked
-- while any application references it, breaking test teardown and making
-- normal cleanup impossible.

BEGIN;

ALTER TABLE loan_applications
  DROP CONSTRAINT loan_applications_tenant_id_employee_id_fkey,
  ADD CONSTRAINT loan_applications_tenant_id_employee_id_fkey
    FOREIGN KEY (tenant_id, employee_id)
    REFERENCES employees (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE loan_applications
  DROP CONSTRAINT loan_applications_tenant_id_loan_product_id_fkey,
  ADD CONSTRAINT loan_applications_tenant_id_loan_product_id_fkey
    FOREIGN KEY (tenant_id, loan_product_id)
    REFERENCES loan_products (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE loans
  DROP CONSTRAINT loans_tenant_id_application_id_fkey,
  ADD CONSTRAINT loans_tenant_id_application_id_fkey
    FOREIGN KEY (tenant_id, application_id)
    REFERENCES loan_applications (tenant_id, id) ON DELETE CASCADE;

COMMIT;