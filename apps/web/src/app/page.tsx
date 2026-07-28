// apps/web/src/app/page.tsx - the dashboard.
// Thin: fetch role-aware data, then render the matching dashboard component.
// An approver (CFO/HR/CEO/dept_head) sees the book + their worklist; an
// ordinary employee sees only their own position.
import { headers } from "next/headers";
import { requireSession } from "@/lib/guard";
import {
  resolveTenant,
  employeeMetrics,
  approverMetrics,
  loansByProduct,
  inboxFor,
} from "@wola/db";
import { db } from "@/lib/tenant";
import Shell from "@/components/shell";
import DashboardCFO from "@/components/dashboard-cfo";
import DashboardEmployee from "@/components/dashboard-employee";

export default async function Dashboard() {
  const slug = (await headers()).get("x-tenant-slug") ?? "";
  const tenant = slug ? await resolveTenant(db, slug) : null;

  const data = await requireSession(async (tx, ctx) => {
    const [me] = await tx`
      SELECT e.id, e.full_name, u.email
      FROM users u
      LEFT JOIN employees e ON e.user_id = u.id
      WHERE u.id = ${ctx.userId}`;

    const user = {
      name: (me?.full_name as string) ?? (me?.email as string) ?? "User",
      email: (me?.email as string) ?? "",
      role: ctx.role,
      canSeeAllLoans: ctx.canSeeAllLoans,
    };

    const mine = await employeeMetrics(tx, ctx.userId);

    if (!ctx.canSeeAllLoans) {
      return { user, mine, book: null, inbox: [], mix: [] };
    }

    // Approver: fetch the queue AND pass the items through (not just the count).
    const inbox = await inboxFor(tx, ctx.tenantId, {
      userId: ctx.userId,
      employeeId: (me?.id as string) ?? null,
      role: ctx.role,
    });
    const book = await approverMetrics(tx, inbox.length);
    const mix = await loansByProduct(tx);
    return { user, mine, book, inbox, mix };
  });

  const { user, mine, book, inbox, mix } = data;

  return (
    <Shell user={user} tenantName={(tenant?.name as string) ?? "Wola"}>
      {book ? (
        <DashboardCFO
          book={book}
          inbox={inbox as never[]}
          mix={mix as never[]}
        />
      ) : (
        <DashboardEmployee mine={mine} />
      )}
    </Shell>
  );
}
