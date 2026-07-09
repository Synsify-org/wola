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