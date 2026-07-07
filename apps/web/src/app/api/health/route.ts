// GET /api/health — proves the full chain works:
// subdomain -> middleware -> tenant resolution -> RLS-scoped query.
import { NextResponse } from "next/server";
import { withTenant, TenantError } from "@/lib/tenant";

export async function GET() {
  try {
    const body = await withTenant(async (tx, tenant) => {
      const [row] = await tx`SELECT count(*)::int AS employees FROM employees`;
      return { ok: true, tenant: tenant.slug, plan: tenant.plan, employees: row.employees };
    });
    return NextResponse.json(body);
  } catch (e) {
    if (e instanceof TenantError)
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    throw e;
  }
}
