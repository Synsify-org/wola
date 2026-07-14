-- 0007_department_head_link.sql
-- department_head was free text (a name), which cannot be routed to. The
-- approval engine must put an application in front of a real person, so link
-- an employee to their department head's EMPLOYEE record. Same-tenant enforced
-- via the composite FK. The text column stays for display/back-compat.
BEGIN;

ALTER TABLE employees
  ADD COLUMN department_head_id uuid,
  ADD CONSTRAINT employees_dept_head_fk
    FOREIGN KEY (tenant_id, department_head_id)
    REFERENCES employees (tenant_id, id) ON DELETE SET NULL;

CREATE INDEX employees_dept_head_idx ON employees (tenant_id, department_head_id);

-- Rejections must carry a reason (audit + grievance protection). Enforced at
-- the app layer too, but the DB is the last line.
ALTER TABLE approvals
  ADD CONSTRAINT approvals_rejection_needs_reason
    CHECK (decision <> 'rejected' OR (comment IS NOT NULL AND length(trim(comment)) > 0));

COMMIT;