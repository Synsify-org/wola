import postgres from "postgres";
import "dotenv/config";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) { console.error("DATABASE_ADMIN_URL is required"); process.exit(1); }

const sql = postgres(url, { max: 1 });

const TENANT_SLUG = "testco";
const TENANT_NAME = "Kampala Steelworks Ltd";
const OTHER_SLUG = "other";
const OTHER_NAME = "Nile Textiles Ltd";

const people = [
  { email: "cfo@testco.io", name: "Daniel Ssebunya" },
  { email: "hr@testco.io", name: "Grace Namuli" },
  { email: "ceo@testco.io", name: "Patrick Mukasa" },
  { email: "head@testco.io", name: "Isaac Wanyama" },
  { email: "staff@testco.io", name: "Brenda Nakato" },
];

try {
  const [t] = await sql`UPDATE tenants SET name = ${TENANT_NAME} WHERE slug = ${TENANT_SLUG} RETURNING slug, name`;
  await sql`UPDATE tenants SET name = ${OTHER_NAME} WHERE slug = ${OTHER_SLUG}`;

  const tenant = await sql`SELECT id FROM tenants WHERE slug = ${TENANT_SLUG}`;
  const T = tenant[0]?.id;
  if (!T) { console.error("testco tenant not found - run seed-dev first"); process.exit(1); }

  for (const p of people) {
    await sql`UPDATE users SET name = ${p.name} WHERE email = ${p.email}`;
    await sql`UPDATE employees e SET full_name = ${p.name} FROM users u WHERE u.email = ${p.email} AND e.user_id = u.id AND e.tenant_id = ${T}`;
  }

  const check = await sql`SELECT e.employee_no, e.full_name, u.email FROM employees e JOIN users u ON u.id = e.user_id WHERE e.tenant_id = ${T} ORDER BY e.employee_no`;
  console.log("tenant:", t?.name);
  console.table(check.map((r) => ({ no: r.employee_no, name: r.full_name, email: r.email })));
  console.log("reskin applied");
} catch (err) {
  console.error("reskin failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
