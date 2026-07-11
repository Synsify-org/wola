// apps/web/src/app/page.tsx — guarded home. First page that USES auth.
// Unauthenticated or wrong-tenant sessions are bounced to /login by
// requireSession(). Shows the current tenant's loan products via RLS.
import { requireSession } from "@/lib/guard";
import { resolveTenant, type Tx } from "@wola/db";
import { db } from "@/lib/tenant";
import { headers } from "next/headers";

type Product = { id: string; name: string; kind: string; active: boolean };
type Me = { name: string; email: string; role: string };

export default async function Home() {
  const data = await requireSession(
    async (tx: Tx, { userId }: { tenantId: string; userId: string }) => {
      const products = (await tx`
        SELECT id, name, kind, active FROM loan_products ORDER BY name`) as unknown as Product[];
      const rows = (await tx`
        SELECT u.name, u.email, m.role
        FROM users u JOIN memberships m ON m.user_id = u.id
        WHERE u.id = ${userId}`) as unknown as Me[];
      return { products, me: rows[0] ?? null };
    },
  );

  // tenant name for the header (resolve again; cheap, cached later)
  const slug = (await headers()).get("x-tenant-slug") ?? "";
  const tenant = slug ? await resolveTenant(db, slug) : null;

  return (
    <main style={{ maxWidth: 720, margin: "6vh auto", fontFamily: "system-ui", padding: "0 16px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid #eee", paddingBottom: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>{tenant?.name ?? slug}</h1>
          <p style={{ margin: "4px 0 0", color: "#666", fontSize: 14 }}>
            {data.me?.name} · {data.me?.role} · {data.me?.email}
          </p>
        </div>
        <form action="/api/logout" method="post">
          <button type="submit" style={{ padding: "6px 12px" }}>Sign out</button>
        </form>
      </header>

      <a href="/loans" style={{ fontSize: 14, marginRight: 12 }}>Loan register</a>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 18 }}>Loan products</h2>
        {data.products.length === 0 ? (
          <p style={{ color: "#666" }}>No loan products configured yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#666", fontSize: 13 }}>
                <th style={{ padding: "8px 0" }}>Name</th>
                <th>Kind</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "10px 0" }}>{p.name}</td>
                  <td style={{ textTransform: "capitalize" }}>{p.kind}</td>
                  <td style={{ color: p.active ? "#137333" : "#999" }}>
                    {p.active ? "Active" : "Inactive"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}