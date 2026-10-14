// scripts/lib/tenant-sql.mjs: the SQL that creates one client organisation, ready for the Supabase
// SQL Editor. Pure: it takes the answers and returns text, so the tests can run the very same SQL
// against a real database.
//
// What it creates, all-or-nothing:
//   - the organisation (active),
//   - (template "benefit-scheme") the three staff-loan products and the approval chains that were
//     confirmed with MUA HR (see DECISIONS.md): limits, longest terms, post-probation and
//     final-warning rules, "no car loan and development loan together", and the CEO-applies routes,
//   - an invitation for the first administrator, and the email that carries it.
// With trial: true the organisation is flagged as a TRIAL (settings.trial): every page shows a "practice data"
// banner, and only a trial organisation can be given practice loans and repayments by a platform operator.
// It creates NO password and NO staff. The administrator chooses their own password from the
// invitation link, and staff are loaded afterwards from inside Wola (Settings -> Employees).
// It does not invent an interest rate: setting the rate index is the administrator's first job.
import { createHash } from "node:crypto";

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const html = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export const RESERVED_SLUGS = ["www", "app", "api", "admin", "docs", "status", "mail", "staging", "assets", "cdn", "auth", "billing", "support", "demo"];
export const TEMPLATES = ["benefit-scheme", "blank"];

export function validate({ slug, name, adminEmail, adminName, origin, template }) {
  const errors = [];
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug ?? "")) errors.push("The short name (slug) must be 2 to 31 characters: lowercase letters, digits and hyphens, not starting with a hyphen.");
  if (RESERVED_SLUGS.includes(slug)) errors.push(`"${slug}" is reserved and cannot be used.`);
  if (!name?.trim()) errors.push("The organisation's name is required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail ?? "")) errors.push("A valid email for the first administrator is required.");
  if (!adminName?.trim()) errors.push("The first administrator's name is required.");
  if (!/^https:\/\/[^\s/]+$/.test(origin ?? "") && !/^http:\/\/(localhost|[a-z0-9-]+\.(local|localhost|test))(:\d+)?$/.test(origin ?? "")) errors.push("The web address must look like https://mua.example.com (no path, no trailing slash).");
  if (!TEMPLATES.includes(template)) errors.push(`The template must be one of: ${TEMPLATES.join(", ")}.`);
  return errors;
}

const PRODUCTS = `
  INSERT INTO loan_products (tenant_id, name, kind, cap_method, cap_basis, cap_multiple, takehome_factor, takehome_multiplier, max_tenor_months, interest_applies, requires_post_probation, blocked_by_final_warning, requires_external_declaration) VALUES
    (t, 'Salary Advance',   'advance', 'salary_multiple',  'gross', 1,    NULL, NULL, 3,  false, true, true, false),
    (t, 'Development Loan', 'term',    'salary_multiple',  'gross', 3,    NULL, NULL, 36, true,  true, true, true),
    (t, 'Staff Car Loan',   'asset',   'takehome_factor',  'net',   NULL, 0.4,  30,   36, true,  true, true, true);

  -- A car loan and a development loan cannot run together (an advance may run with either).
  INSERT INTO product_exclusions (tenant_id, loan_product_id, excludes_product_id, reason)
  SELECT t, a.id, b.id, 'Benefit scheme: no concurrent car and development loan'
  FROM loan_products a JOIN loan_products b ON b.tenant_id = a.tenant_id
  WHERE a.tenant_id = t AND ((a.kind = 'asset' AND b.kind = 'term') OR (a.kind = 'term' AND b.kind = 'asset'));

  -- Everyone's loans: department head -> HR -> CFO -> CEO.
  INSERT INTO approval_pipelines (tenant_id, loan_product_id, applies_to)
  SELECT t, id, 'default' FROM loan_products WHERE tenant_id = t;
  INSERT INTO approval_stages (tenant_id, pipeline_id, position, approver_role)
  SELECT t, p.id, v.position, v.role FROM approval_pipelines p
  CROSS JOIN (VALUES (1, 'dept_head'), (2, 'hr'), (3, 'cfo'), (4, 'ceo')) AS v(position, role)
  WHERE p.tenant_id = t AND p.applies_to = 'default';

  -- When the CEO applies, the CEO cannot approve their own loan: an advance goes HR -> CFO -> COO ...
  INSERT INTO approval_pipelines (tenant_id, loan_product_id, applies_to)
  SELECT t, id, 'ceo' FROM loan_products WHERE tenant_id = t;
  INSERT INTO approval_stages (tenant_id, pipeline_id, position, approver_role)
  SELECT t, p.id, v.position, v.role FROM approval_pipelines p JOIN loan_products lp ON lp.id = p.loan_product_id
  CROSS JOIN (VALUES (1, 'hr'), (2, 'cfo'), (3, 'coo')) AS v(position, role)
  WHERE p.tenant_id = t AND p.applies_to = 'ceo' AND lp.kind = 'advance';
  -- ... and a development or car loan goes HR -> CFO -> COO -> group CEO.
  INSERT INTO approval_stages (tenant_id, pipeline_id, position, approver_role)
  SELECT t, p.id, v.position, v.role FROM approval_pipelines p JOIN loan_products lp ON lp.id = p.loan_product_id
  CROSS JOIN (VALUES (1, 'hr'), (2, 'cfo'), (3, 'coo'), (4, 'group_ceo')) AS v(position, role)
  WHERE p.tenant_id = t AND p.applies_to = 'ceo' AND lp.kind IN ('term', 'asset');
`;

/** @returns {{ sql: string, link: string }} */
export function tenantSql({ slug, name, adminEmail, adminName, origin, template = "benefit-scheme", token, trial = false }) {
  const errors = validate({ slug, name, adminEmail, adminName, origin, template });
  if (errors.length) throw new Error(errors.join(" "));
  const email = adminEmail.trim().toLowerCase();
  const link = `${origin}/accept-invite?token=${token}`;
  const subject = `You've been invited to set up ${name.trim()} on Wola`;
  const body = `<p>Hello ${html(adminName.trim())},</p>` +
    `<p>You have been invited to set up <b>${html(name.trim())}</b> on Wola as its administrator.</p>` +
    `<p><a href="${html(link)}">Accept the invitation</a>. This link expires in 7 days, and you will choose your own password.</p>`;

  const sql = `-- Wola: create the organisation "${name.trim().replace(/[\r\n]+/g, " ")}" (${slug}). Run once in the Supabase SQL Editor.
-- All-or-nothing. Stops with a message if the short name is already taken.
DO $wola$
DECLARE t uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM tenants WHERE slug = ${lit(slug)}) THEN
    RAISE EXCEPTION 'An organisation with the short name % already exists. Nothing was changed.', ${lit(slug)};
  END IF;

  INSERT INTO tenants (slug, name, status${trial ? ", settings" : ""}) VALUES (${lit(slug)}, ${lit(name.trim())}, 'active'${trial ? `, '{"trial": true}'::jsonb` : ""}) RETURNING id INTO t;
${template === "benefit-scheme" ? PRODUCTS : "  -- template \"blank\": no products or approval chains; the administrator sets them up.\n"}
  -- The first administrator: an invitation (they set their own password) and the email that carries it.
  INSERT INTO invitations (tenant_id, email, role, token_hash, expires_at)
  VALUES (t, ${lit(email)}, 'org_admin', ${lit(sha256(token))}, now() + interval '7 days');
  INSERT INTO email_outbox (tenant_id, to_email, subject, body_html)
  VALUES (t, ${lit(email)}, ${lit(subject)}, ${lit(body)});
END
$wola$;

SELECT t.slug, t.name, t.status,
       (SELECT count(*) FROM loan_products WHERE tenant_id = t.id) AS products,
       (SELECT count(*) FROM approval_stages WHERE tenant_id = t.id) AS approval_stages,
       (SELECT count(*) FROM invitations WHERE tenant_id = t.id) AS invitations,
       (SELECT count(*) FROM email_outbox WHERE tenant_id = t.id AND status = 'pending') AS emails_queued
FROM tenants t WHERE t.slug = ${lit(slug)};
`;
  return { sql, link };
}
