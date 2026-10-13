// Roles & access: who can sign in to this organisation and what each role may
// do. Everyone with the administration view can read it; administrators change
// it (ACCESS_EDIT_ROLES — also enforced in the server actions). The "what each
// role can do" table is computed from the same constants the guard and the
// pages use, so it can't drift from what the system actually enforces.
import { Check, Minus } from "lucide-react";
import { listAccess } from "@wola/db";
import { MEMBERSHIP_ROLES } from "@wola/engine";
import { requireSession } from "@/lib/guard";
import {
  ACCESS_EDIT_ROLES, ACCOUNT_CREATOR_ROLES, APPROVER_ROLES, CONFIG_VIEW_ROLES, DISBURSER_ROLES,
  EMPLOYEE_DATA_ROLES, FINANCE_ROLES, FULL_BOOK_ROLES, PRODUCT_EDIT_ROLES, RATE_INDEX_EDIT_ROLES,
  ROLE_DESCRIPTION, ROUTING_EDIT_ROLES,
} from "@/lib/permissions";
import { roleLabel } from "@/lib/product-summary";
import AccessManager from "@/components/access-manager";
import { pageMeta } from "@/lib/site";
import Breadcrumbs from "@/components/breadcrumbs";

const fmtDate = (d: Date) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export const metadata = pageMeta({ title: "Roles & access", description: "Who can sign in to this organisation, and what each role can do.", path: "/settings/access" });

export default async function AccessPage() {
  const data = await requireSession(async (tx, ctx) => {
    if (!CONFIG_VIEW_ROLES.includes(ctx.role)) return { authorized: false as const };
    return {
      authorized: true as const,
      overview: await listAccess(tx, ctx.tenantId),
      me: ctx.userId,
      canEdit: ACCESS_EDIT_ROLES.includes(ctx.role),
    };
  });

  if (!data.authorized) {
    return (
      <div className="rounded-xl border border-rule bg-surface p-8 text-center shadow-theme-sm">
        <p className="text-sm text-ink-soft">Roles &amp; access is available to administrators and executives only.</p>
      </div>
    );
  }
  const { overview, me, canEdit } = data;

  const caps = (role: string) => ({
    sees: FULL_BOOK_ROLES.includes(role) ? "Whole organisation" : role === "dept_head" ? "Their department" : "Only themselves",
    approves: APPROVER_ROLES.includes(role),
    money: DISBURSER_ROLES.includes(role) || FINANCE_ROLES.includes(role),
    people: EMPLOYEE_DATA_ROLES.includes(role),
    invites: ACCOUNT_CREATOR_ROLES.includes(role),
    products: PRODUCT_EDIT_ROLES.includes(role),
    routing: ROUTING_EDIT_ROLES.includes(role),
    rates: RATE_INDEX_EDIT_ROLES.includes(role),
    access: ACCESS_EDIT_ROLES.includes(role),
  });
  const cols: { key: keyof ReturnType<typeof caps>; label: string }[] = [
    { key: "approves", label: "Approves loans" },
    { key: "money", label: "Disburses & records repayments" },
    { key: "people", label: "Edits employee records" },
    { key: "invites", label: "Invites staff" },
    { key: "products", label: "Loan products" },
    { key: "rates", label: "Interest rates" },
    { key: "routing", label: "Approval routing" },
    { key: "access", label: "Roles & access" },
  ];

  return (
    <>
      <div className="mb-6">
        <Breadcrumbs items={[{ label: "Settings", href: "/settings" }, { label: "Roles & access" }]} />
        <h1 className="mt-1 text-xl font-semibold text-ink">Roles &amp; access</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Who can sign in to this organisation, and as what. A change applies on the person&apos;s very next click.
        </p>
      </div>

      {!canEdit ? (
        <div className="mb-4 rounded-xl bg-awaiting-wash px-4 py-2.5 text-sm text-ink">
          View only. Access is changed by an administrator.
        </div>
      ) : null}

      <div className="max-w-4xl">
        <AccessManager
          canEdit={canEdit}
          people={overview.people.map((p) => ({
            userId: p.userId, email: p.email, name: p.name, role: p.role,
            employeeNo: p.employeeNo, department: p.department, title: p.title, isYou: p.userId === me,
          }))}
          invites={overview.invites.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresOn: fmtDate(i.expiresAt) }))}
          employeesWithoutLogin={overview.employeesWithoutLogin}
        />
      </div>

      <section className="mt-8 max-w-6xl">
        <h2 className="text-[1.0625rem] font-semibold text-ink">What each role can do</h2>
        <p className="mb-3 mt-1 text-sm text-ink-soft">
          Read straight from the rules the system enforces. A department head sees only the people who report to them; an
          auditor can see everything and change nothing.
        </p>
        <div className="overflow-x-auto rounded-2xl border border-rule bg-surface shadow-theme-xs">
          <table className="ledger ledger--sticky">
            <thead>
              <tr>
                <th>Role</th>
                <th>Sees</th>
                {cols.map((c) => <th key={c.key} className="text-center">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {MEMBERSHIP_ROLES.map((role) => {
                const c = caps(role);
                return (
                  <tr key={role}>
                    <td className="align-top">
                      <div className="font-medium text-ink">{roleLabel(role)}</div>
                      <div className="mt-0.5 max-w-[16rem] whitespace-normal text-xs font-normal text-ink-soft">{ROLE_DESCRIPTION[role]}</div>
                    </td>
                    <td className="whitespace-nowrap text-ink-soft">{c.sees}</td>
                    {cols.map((col) => (
                      <td key={col.key} className="text-center">
                        {c[col.key] ? <Check className="mx-auto h-4 w-4 text-approved" aria-label="Yes" /> : <Minus className="mx-auto h-4 w-4 text-ink-faint" aria-label="No" />}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
