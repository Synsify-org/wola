-- scripts/seed-dev.sql — repeatable dev seed. Run after migrate.
-- Non-reserved slug 'testco' so tests don't wipe it.
INSERT INTO tenants (slug,name,status) VALUES ('testco','Test Co','active')
  ON CONFLICT (slug) DO NOTHING;
INSERT INTO tenants (slug,name,status) VALUES ('other','Other Org','active')
  ON CONFLICT (slug) DO NOTHING;

INSERT INTO users (email,name,status,password_hash)
VALUES ('cfo@testco.io','Test CFO','active',
  '$argon2id$v=19$m=65536,t=3,p=4$TJugSRYYjCh+ItJC9fww6A$tIUgIWP0edcSBp3DKceixC+tPseBl6zhaRoOlMbjWvI')
  ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;

INSERT INTO memberships (tenant_id,user_id,role)
SELECT t.id, u.id, 'cfo' FROM tenants t, users u
WHERE t.slug='testco' AND u.email='cfo@testco.io'
  ON CONFLICT DO NOTHING;

INSERT INTO employees
  (tenant_id, user_id, employee_no, full_name, department, title,
   department_head, gross_salary, net_salary, is_post_probation, on_final_warning)
SELECT t.id, u.id, 'ST001', 'Test CFO', 'Finance', 'Chief Financial Officer',
       'Managing Director', 10000000, 8000000, true, false
FROM tenants t, users u
WHERE t.slug='testco' AND u.email='cfo@testco.io'
  ON CONFLICT (tenant_id, employee_no) DO UPDATE
    SET is_post_probation = true, gross_salary = 10000000, net_salary = 8000000;

INSERT INTO loan_products (tenant_id, name, kind)
SELECT id, 'Salary Advance', 'advance' FROM tenants WHERE slug='testco' ON CONFLICT (tenant_id, name) DO NOTHING;
INSERT INTO loan_products (tenant_id, name, kind)
SELECT id, 'Development Loan', 'term' FROM tenants WHERE slug='testco' ON CONFLICT (tenant_id, name) DO NOTHING;
INSERT INTO loan_products (tenant_id, name, kind)
SELECT id, 'Staff Car Loan', 'asset' FROM tenants WHERE slug='testco' ON CONFLICT (tenant_id, name) DO NOTHING;


-- ── Approval pipelines (CONFIG, not code) ────────────────────────────────
-- MUA's chains expressed as tenant data. A SACCO with a 2-stage chain simply
-- seeds different rows — no code change. The 'ceo' pipelines are the special
-- routes the spec describes for when the CEO themselves applies.

-- Default chain for every product: dept_head -> hr -> cfo -> ceo
INSERT INTO approval_pipelines (tenant_id, loan_product_id, applies_to)
SELECT t.id, lp.id, 'default'
FROM tenants t JOIN loan_products lp ON lp.tenant_id = t.id
WHERE t.slug = 'testco'
ON CONFLICT (tenant_id, loan_product_id, applies_to) DO NOTHING;

INSERT INTO approval_stages (tenant_id, pipeline_id, position, approver_role)
SELECT p.tenant_id, p.id, v.position, v.role
FROM approval_pipelines p
JOIN tenants t ON t.id = p.tenant_id
CROSS JOIN (VALUES (1,'dept_head'), (2,'hr'), (3,'cfo'), (4,'ceo')) AS v(position, role)
WHERE t.slug = 'testco' AND p.applies_to = 'default'
ON CONFLICT (tenant_id, pipeline_id, position) DO NOTHING;

-- CEO applying for an ADVANCE: hr -> cfo -> coo
INSERT INTO approval_pipelines (tenant_id, loan_product_id, applies_to)
SELECT t.id, lp.id, 'ceo'
FROM tenants t JOIN loan_products lp ON lp.tenant_id = t.id
WHERE t.slug = 'testco' AND lp.kind = 'advance'
ON CONFLICT (tenant_id, loan_product_id, applies_to) DO NOTHING;

INSERT INTO approval_stages (tenant_id, pipeline_id, position, approver_role)
SELECT p.tenant_id, p.id, v.position, v.role
FROM approval_pipelines p
JOIN tenants t ON t.id = p.tenant_id
JOIN loan_products lp ON lp.id = p.loan_product_id
CROSS JOIN (VALUES (1,'hr'), (2,'cfo'), (3,'coo')) AS v(position, role)
WHERE t.slug = 'testco' AND p.applies_to = 'ceo' AND lp.kind = 'advance'
ON CONFLICT (tenant_id, pipeline_id, position) DO NOTHING;

-- CEO applying for DEVELOPMENT or CAR: hr -> cfo -> coo -> group_ceo
INSERT INTO approval_pipelines (tenant_id, loan_product_id, applies_to)
SELECT t.id, lp.id, 'ceo'
FROM tenants t JOIN loan_products lp ON lp.tenant_id = t.id
WHERE t.slug = 'testco' AND lp.kind IN ('term','asset')
ON CONFLICT (tenant_id, loan_product_id, applies_to) DO NOTHING;

INSERT INTO approval_stages (tenant_id, pipeline_id, position, approver_role)
SELECT p.tenant_id, p.id, v.position, v.role
FROM approval_pipelines p
JOIN tenants t ON t.id = p.tenant_id
JOIN loan_products lp ON lp.id = p.loan_product_id
CROSS JOIN (VALUES (1,'hr'), (2,'cfo'), (3,'coo'), (4,'group_ceo')) AS v(position, role)
WHERE t.slug = 'testco' AND p.applies_to = 'ceo' AND lp.kind IN ('term','asset')
ON CONFLICT (tenant_id, pipeline_id, position) DO NOTHING;

-- ── Approvers so the pipeline actually has people in it ──────────────────
-- HR, CEO, and a department head. Password for all: test1234
INSERT INTO users (email,name,status,password_hash) VALUES
  ('hr@testco.io','HR Manager','active','$argon2id$v=19$m=65536,t=3,p=4$TJugSRYYjCh+ItJC9fww6A$tIUgIWP0edcSBp3DKceixC+tPseBl6zhaRoOlMbjWvI'),
  ('ceo@testco.io','Chief Executive','active','$argon2id$v=19$m=65536,t=3,p=4$TJugSRYYjCh+ItJC9fww6A$tIUgIWP0edcSBp3DKceixC+tPseBl6zhaRoOlMbjWvI'),
  ('head@testco.io','Ops Manager','active','$argon2id$v=19$m=65536,t=3,p=4$TJugSRYYjCh+ItJC9fww6A$tIUgIWP0edcSBp3DKceixC+tPseBl6zhaRoOlMbjWvI')
ON CONFLICT (email) DO NOTHING;

INSERT INTO memberships (tenant_id,user_id,role)
SELECT t.id, u.id, v.role FROM tenants t, users u,
  (VALUES ('hr@testco.io','hr'), ('ceo@testco.io','ceo'), ('head@testco.io','dept_head')) AS v(email, role)
WHERE t.slug='testco' AND u.email = v.email
ON CONFLICT DO NOTHING;

INSERT INTO employees
  (tenant_id, user_id, employee_no, full_name, department, title, gross_salary, net_salary, is_post_probation)
SELECT t.id, u.id, v.no, v.name, v.dept, v.title, v.gross, v.net, true
FROM tenants t, users u,
  (VALUES
    ('hr@testco.io','ST003','HR Manager','People','HR Manager',7000000,5600000),
    ('ceo@testco.io','ST004','Chief Executive','Executive','CEO',20000000,16000000),
    ('head@testco.io','ST005','Ops Manager','Operations','Head of Operations',9000000,7200000)
  ) AS v(email, no, name, dept, title, gross, net)
WHERE t.slug='testco' AND u.email = v.email
ON CONFLICT (tenant_id, employee_no) DO NOTHING;

-- Link staff + CFO to their department head (ST005 = Ops Manager)
UPDATE employees e SET department_head_id = h.id
FROM employees h
WHERE e.tenant_id = h.tenant_id
  AND h.employee_no = 'ST005'
  AND e.employee_no IN ('ST001','ST002')
  AND e.tenant_id = (SELECT id FROM tenants WHERE slug='testco');

  -- An ordinary employee (no approver role) — the normal-path applicant.
INSERT INTO users (email,name,status,password_hash)
VALUES ('staff@testco.io','Staff Member','active',
  '$argon2id$v=19$m=65536,t=3,p=4$TJugSRYYjCh+ItJC9fww6A$tIUgIWP0edcSBp3DKceixC+tPseBl6zhaRoOlMbjWvI')
  ON CONFLICT (email) DO NOTHING;

INSERT INTO memberships (tenant_id,user_id,role)
SELECT t.id, u.id, 'employee' FROM tenants t, users u
WHERE t.slug='testco' AND u.email='staff@testco.io'
  ON CONFLICT DO NOTHING;

INSERT INTO employees
  (tenant_id, user_id, employee_no, full_name, department, title,
   gross_salary, net_salary, is_post_probation)
SELECT t.id, u.id, 'ST002', 'Staff Member', 'Operations', 'Officer',
       4000000, 3200000, true
FROM tenants t, users u
WHERE t.slug='testco' AND u.email='staff@testco.io'
  ON CONFLICT (tenant_id, employee_no) DO NOTHING;

-- Everyone except the Ops Manager and the CEO reports to the Ops Manager (ST005).
UPDATE employees e SET department_head_id = h.id
FROM employees h
WHERE e.tenant_id = h.tenant_id
  AND h.employee_no = 'ST005'
  AND e.employee_no IN ('ST001','ST002','ST003')
  AND e.tenant_id = (SELECT id FROM tenants WHERE slug='testco');