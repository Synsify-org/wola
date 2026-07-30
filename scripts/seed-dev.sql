-- scripts/seed-dev.sql — repeatable dev seed. Run after migrate.
-- Non-reserved slug 'testco' so tests don't wipe it.
INSERT INTO tenants (slug,name,status) VALUES ('testco','Kampala Steelworks Ltd','active')
  ON CONFLICT (slug) DO NOTHING;
INSERT INTO tenants (slug,name,status) VALUES ('other','Nile Textiles Ltd','active')
  ON CONFLICT (slug) DO NOTHING;

INSERT INTO users (email,name,status,password_hash)
VALUES ('cfo@testco.io','Daniel Ssebunya','active',
  '$argon2id$v=19$m=65536,t=3,p=4$TJugSRYYjCh+ItJC9fww6A$tIUgIWP0edcSBp3DKceixC+tPseBl6zhaRoOlMbjWvI')
  ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;

INSERT INTO memberships (tenant_id,user_id,role)
SELECT t.id, u.id, 'cfo' FROM tenants t, users u
WHERE t.slug='testco' AND u.email='cfo@testco.io'
  ON CONFLICT DO NOTHING;

INSERT INTO employees
  (tenant_id, user_id, employee_no, full_name, department, title,
   department_head, gross_salary, net_salary, is_post_probation, on_final_warning)
SELECT t.id, u.id, 'ST001', 'Daniel Ssebunya', 'Finance', 'Chief Financial Officer',
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
  ('hr@testco.io','Grace Namuli','active','$argon2id$v=19$m=65536,t=3,p=4$TJugSRYYjCh+ItJC9fww6A$tIUgIWP0edcSBp3DKceixC+tPseBl6zhaRoOlMbjWvI'),
  ('ceo@testco.io','Patrick Mukasa','active','$argon2id$v=19$m=65536,t=3,p=4$TJugSRYYjCh+ItJC9fww6A$tIUgIWP0edcSBp3DKceixC+tPseBl6zhaRoOlMbjWvI'),
  ('head@testco.io','Isaac Wanyama','active','$argon2id$v=19$m=65536,t=3,p=4$TJugSRYYjCh+ItJC9fww6A$tIUgIWP0edcSBp3DKceixC+tPseBl6zhaRoOlMbjWvI')
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
    ('hr@testco.io','ST003','Grace Namuli','People','HR Manager',7000000,5600000),
    ('ceo@testco.io','ST004','Patrick Mukasa','Executive','CEO',20000000,16000000),
    ('head@testco.io','ST005','Isaac Wanyama','Operations','Head of Operations',9000000,7200000)
  ) AS v(email, no, name, dept, title, gross, net)
WHERE t.slug='testco' AND u.email = v.email
ON CONFLICT (tenant_id, employee_no) DO NOTHING;

  -- An ordinary employee (no approver role) — the normal-path applicant.
INSERT INTO users (email,name,status,password_hash)
VALUES ('staff@testco.io','Brenda Nakato','active',
  '$argon2id$v=19$m=65536,t=3,p=4$TJugSRYYjCh+ItJC9fww6A$tIUgIWP0edcSBp3DKceixC+tPseBl6zhaRoOlMbjWvI')
  ON CONFLICT (email) DO NOTHING;

INSERT INTO memberships (tenant_id,user_id,role)
SELECT t.id, u.id, 'employee' FROM tenants t, users u
WHERE t.slug='testco' AND u.email='staff@testco.io'
  ON CONFLICT DO NOTHING;

INSERT INTO employees
  (tenant_id, user_id, employee_no, full_name, department, title,
   gross_salary, net_salary, is_post_probation)
SELECT t.id, u.id, 'ST002', 'Brenda Nakato', 'Operations', 'Officer',
       4000000, 3200000, true
FROM tenants t, users u
WHERE t.slug='testco' AND u.email='staff@testco.io'
  ON CONFLICT (tenant_id, employee_no) DO NOTHING;

-- Three more Operations staff so the Ops Head's DEPARTMENT view has real size
-- (and so scoping is visibly a subset, not the whole book). Ordinary employees.
INSERT INTO users (email,name,status,password_hash) VALUES
  ('musoke@testco.io','David Musoke','active','$argon2id$v=19$m=65536,t=3,p=4$TJugSRYYjCh+ItJC9fww6A$tIUgIWP0edcSBp3DKceixC+tPseBl6zhaRoOlMbjWvI'),
  ('achieng@testco.io','Faith Achieng','active','$argon2id$v=19$m=65536,t=3,p=4$TJugSRYYjCh+ItJC9fww6A$tIUgIWP0edcSBp3DKceixC+tPseBl6zhaRoOlMbjWvI'),
  ('okello@testco.io','Samuel Okello','active','$argon2id$v=19$m=65536,t=3,p=4$TJugSRYYjCh+ItJC9fww6A$tIUgIWP0edcSBp3DKceixC+tPseBl6zhaRoOlMbjWvI')
ON CONFLICT (email) DO NOTHING;

INSERT INTO memberships (tenant_id,user_id,role)
SELECT t.id, u.id, 'employee' FROM tenants t, users u
WHERE t.slug='testco' AND u.email IN ('musoke@testco.io','achieng@testco.io','okello@testco.io')
  ON CONFLICT DO NOTHING;

INSERT INTO employees
  (tenant_id, user_id, employee_no, full_name, department, title,
   gross_salary, net_salary, is_post_probation)
SELECT t.id, u.id, v.no, v.name, 'Operations', v.title, v.gross, v.net, true
FROM tenants t, users u,
  (VALUES
    ('musoke@testco.io','ST006','David Musoke','Line Supervisor',5000000,4000000),
    ('achieng@testco.io','ST007','Faith Achieng','Machinist',3500000,2800000),
    ('okello@testco.io','ST008','Samuel Okello','Welder',3000000,2400000)
  ) AS v(email, no, name, title, gross, net)
WHERE t.slug='testco' AND u.email = v.email
ON CONFLICT (tenant_id, employee_no) DO NOTHING;

-- Realistic reporting: only Operations staff report to the Ops Head (ST005).
-- Daniel (CFO/Finance) and Grace (HR/People) head their own functions and do
-- NOT report to Operations. This makes a dept head's view a STRICT SUBSET of
-- the company book, so department scoping is visibly demonstrable (their view
-- excludes Finance/People loans they must not see).
-- Reset first so re-running fixes any prior (backwards) links, THEN set only
-- the real Operations reports. Idempotent: correct state regardless of history.
UPDATE employees SET department_head_id = NULL
WHERE tenant_id = (SELECT id FROM tenants WHERE slug='testco');

UPDATE employees e SET department_head_id = h.id
FROM employees h
WHERE e.tenant_id = h.tenant_id
  AND h.employee_no = 'ST005'
  AND e.employee_no IN ('ST002','ST006','ST007','ST008')
  AND e.tenant_id = (SELECT id FROM tenants WHERE slug='testco');
-- ── MUA benefit scheme, as CONFIGURATION ────────────────────────────────
-- These are rows, not code. A SACCO seeds different numbers and Wola works
-- for them with no release. The car factor below (0.4) is the SIGNED scheme;
-- if MUA confirms the briefing example instead, an admin changes this number.

UPDATE loan_products SET
  cap_method = 'salary_multiple', cap_basis = 'gross', cap_multiple = 1,
  max_tenor_months = 3, interest_applies = false,
  requires_post_probation = true, blocked_by_final_warning = true,
  requires_external_declaration = false
WHERE kind = 'advance'
  AND tenant_id = (SELECT id FROM tenants WHERE slug = 'testco');

UPDATE loan_products SET
  cap_method = 'salary_multiple', cap_basis = 'gross', cap_multiple = 3,
  max_tenor_months = 36, interest_applies = true,
  requires_post_probation = true, blocked_by_final_warning = true,
  requires_external_declaration = false
WHERE kind = 'term'
  AND tenant_id = (SELECT id FROM tenants WHERE slug = 'testco');

UPDATE loan_products SET
  cap_method = 'takehome_factor', cap_basis = 'net',
  takehome_factor = 0.4, takehome_multiplier = 30,
  max_tenor_months = 36, interest_applies = true,
  requires_post_probation = true, blocked_by_final_warning = true,
  requires_external_declaration = true
WHERE kind = 'asset'
  AND tenant_id = (SELECT id FROM tenants WHERE slug = 'testco');

-- Car and development cannot run together. An advance may run with either.
INSERT INTO product_exclusions (tenant_id, loan_product_id, excludes_product_id, reason)
SELECT car.tenant_id, car.id, dev.id, 'Benefit scheme: no concurrent car and development loan'
FROM loan_products car
JOIN loan_products dev
  ON dev.tenant_id = car.tenant_id AND dev.kind = 'term'
WHERE car.kind = 'asset'
  AND car.tenant_id = (SELECT id FROM tenants WHERE slug = 'testco')
ON CONFLICT DO NOTHING;

INSERT INTO product_exclusions (tenant_id, loan_product_id, excludes_product_id, reason)
SELECT dev.tenant_id, dev.id, car.id, 'Benefit scheme: no concurrent car and development loan'
FROM loan_products dev
JOIN loan_products car
  ON car.tenant_id = dev.tenant_id AND car.kind = 'asset'
WHERE dev.kind = 'term'
  AND dev.tenant_id = (SELECT id FROM tenants WHERE slug = 'testco')
ON CONFLICT DO NOTHING;