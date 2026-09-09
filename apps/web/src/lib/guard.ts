// apps/web/src/lib/guard.ts — call at the top of any protected page/route.
import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveTenant, tenantTx, type Tx } from "@wola/db";
import { db } from "./tenant";
import { verifySession, SESSION_COOKIE } from "./auth";

// THREE data tiers, not two. The old single boolean couldn't express a dept
// head who sees their DEPARTMENT (not the whole book, not just themselves).
//
//   scope = "all"        — full-book roles: every employee in the tenant
//   scope = "department" — dept_head: employees who report to them
//                          (employees.department_head_id = their employee id)
//   scope = "own"        — employee: only themselves
//
// canSeeAllLoans / canApprove stay as UI/nav flags (which tabs show, who may
// act on the worklist). scope drives DATA. Keeping them separate is what lets a
// dept head KEEP the Approvals tab while their data is department-limited.
//
//   canSeeAllLoans — whole-book DATA + analytics/reports tabs (finance/exec)
//   canApprove     — approval worklist access (adds dept_head)
// NOTE: the membership role enum (migration 0001) uses 'org_admin' and
// 'group_ceo'. Older code referenced 'admin'/'md'; both spellings are kept here
// so a tenant provisioned with the real enum roles gets the right access. On-prem
// installs create an 'org_admin' first user — it must land in FULL_BOOK_ROLES.
//
// 'auditor' is in FULL_BOOK_ROLES (read access to the whole book) but
// deliberately NOT in APPROVER_ROLES, and must never be added to
// DISBURSER_ROLES (loans/[id]/actions.ts) or FINANCE_ROLES (repay-actions.ts)
// — oversight, not action. It was in the role enum with no handling here at
// all until this fix, which meant an auditor fell through to plain-employee
// (scope="own") and saw almost nothing.
const FULL_BOOK_ROLES = ["cfo", "hr", "ceo", "md", "coo", "group_ceo", "admin", "org_admin", "auditor"];
const APPROVER_ROLES = ["cfo", "hr", "ceo", "md", "coo", "group_ceo", "dept_head", "admin", "org_admin"];

export type LoanScope = "all" | "department" | "own";

export type SessionCtx = {
  tenantId: string;
  userId: string;
  role: string;
  canSeeAllLoans: boolean;
  canApprove: boolean;
  /** How widely this session may see loan/application DATA. */
  scope: LoanScope;
  /** The caller's own employee id in this tenant (null if no employee row). */
  employeeId: string | null;
  /** For a dept_head: employee ids that report to them (their own included).
   *  Empty for other roles. Used to build the "department" data predicate. */
  scopeEmployeeIds: string[];
};

/** Reusable WHERE predicate for the current session's data scope. Pass the
 *  table alias whose `id` / `user_id` columns identify the applicant employee
 *  (defaults to `e`). ONE source of truth so no page hand-rolls the branch.
 *
 *  `force` narrows the scope for a specific page: the /loans ("My loans") page
 *  passes force="own" so even a manager sees only their OWN loans there, while
 *  the /book page uses the role's natural scope. force can only NARROW, never
 *  widen — passing force="all" for an employee still yields their own rows,
 *  because we take the more restrictive of (natural, forced).
 *
 *  - all:        TRUE
 *  - department: e.id IN (their reports)  [fails CLOSED to no rows if empty]
 *  - own:        e.user_id = :userId
 */
export function scopePredicate(
  tx: Tx,
  ctx: SessionCtx,
  force?: LoanScope,
) {
  // Effective scope = the more restrictive of the role's natural scope and any
  // forced scope. Ordering own < department < all.
  const rank: Record<LoanScope, number> = { own: 0, department: 1, all: 2 };
  const effective: LoanScope =
    force && rank[force] < rank[ctx.scope] ? force : ctx.scope;

  if (effective === "all") return tx`TRUE`;
  if (effective === "department") {
    // Fail closed: a dept head with no reports sees nothing, not everything.
    if (ctx.scopeEmployeeIds.length === 0) return tx`FALSE`;
    return tx`e.id = ANY(${ctx.scopeEmployeeIds})`;
  }
  return tx`e.user_id = ${ctx.userId}`;
}

/** Require a valid session for the CURRENT tenant. Redirects to /login
 *  on any failure. Returns tenant + userId + role, runs fn in RLS scope. */
export async function requireSession<T>(
  fn: (tx: Tx, ctx: SessionCtx) => Promise<T>,
): Promise<T> {
  const slug = (await headers()).get("x-tenant-slug");
  if (!slug) redirect("/login");
  const tenant = await resolveTenant(db, slug);
  if (!tenant) redirect("/login");

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token, tenant.id as string);
  if (!session) redirect("/login");

  return tenantTx(db, tenant.id as string, async (tx) => {
    // Role comes from the membership in THIS tenant.
    const [m] = await tx`
      SELECT role FROM memberships
      WHERE user_id = ${session.userId} AND tenant_id = ${tenant.id}`;
    const role = (m?.role as string) ?? "employee";
    const canSeeAllLoans = FULL_BOOK_ROLES.includes(role);

    // The caller's own employee row in this tenant (may be null for pure
    // platform users who have no employee record).
    const [meEmp] = await tx`
      SELECT id FROM employees WHERE user_id = ${session.userId} LIMIT 1`;
    const employeeId = (meEmp?.id as string) ?? null;

    // Data scope. Full-book roles => all. dept_head => department (resolve
    // reports). Everyone else => own.
    let scope: LoanScope = canSeeAllLoans ? "all" : "own";
    let scopeEmployeeIds: string[] = [];
    if (!canSeeAllLoans && role === "dept_head" && employeeId) {
      scope = "department";
      // Employees who report to this head, plus the head themselves (so their
      // own loans show in their department view too).
      const reports = await tx`
        SELECT id FROM employees
        WHERE department_head_id = ${employeeId} OR id = ${employeeId}`;
      scopeEmployeeIds = reports.map((r) => r.id as string);
    }

    return fn(tx, {
      tenantId: tenant.id as string,
      userId: session.userId,
      role,
      canSeeAllLoans,
      canApprove: APPROVER_ROLES.includes(role),
      scope,
      employeeId,
      scopeEmployeeIds,
    });
  });
}
