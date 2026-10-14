# Wola: route map

One address per page, named the way the menu names it. If a page's menu label and its address
disagree, the address is the one to fix (that is how `/reconciliation` became `/payroll`).

The menu a person sees is decided in two steps in `apps/web/src/components/nav-links.tsx`:
what their role is **allowed** to open (the `need` rules), then what belongs in **their** menu
(`ROLE_FOCUS`). A page missing from someone's menu may still open by address if the access rules
allow it. `nav-roles.test.ts` checks that every menu link has a page.

## Organisation (tenant) site: `<company>.<domain>`

| Address | Menu label | Who it is for |
|---|---|---|
| `/` | Dashboard | everyone; the content changes by role |
| `/apply` | Apply | everyone except the auditor |
| `/applications` | Applications / My applications | everyone; staff see only their own |
| `/applications/:id` | | the applicant and anyone on the approval chain |
| `/loans` | My loans | everyone; finance roles see the whole book on `/book` |
| `/loans/:id` | | the borrower and the oversight roles |
| `/approvals` | Approvals | roles on an approval chain |
| `/book` | Book / Department | oversight roles; a department head sees their own department |
| `/payroll` | Payroll | any whole-book role may open it; it is in the menu of the CFO and COO |
| `/payroll/expected.csv?cycle=YYYY-MM` | | download: the deductions payroll should make |
| `/analytics` | Analytics | whole-book roles |
| `/reports` | Reports | whole-book roles |
| `/audit-log` | Audit log | whole-book roles and the auditor |
| `/notifications` | the bell | everyone |
| `/settings` | Settings | everyone (their account); administrators also get the organisation's settings |
| `/settings/employees` | Employees | whole-book roles can view it; HR imports and edits; in the menu of HR and administrators |
| `/settings/products`, `/settings/products/new`, `/settings/products/:id` | | administrators and executives: loan products |
| `/settings/routing` | | administrators and executives: approval chains |
| `/settings/access` | | administrators and executives: who may sign in and what each role can do |
| `/settings/security` | | every signed-in user: password and two-step sign-in |

Signed-out pages: `/login`, `/forgot-password`, `/reset-password`, `/accept-invite`.

## Platform console: `<domain>/admin`

`/admin` (overview), `/admin/tenants`, `/admin/tenants/:id`, `/admin/audit-log`, `/admin/security`,
`/admin/login`. Platform operators only; separate sign-in with two-step verification.

## Machine endpoints

`/api/health` (uptime monitor; see the response headers for database speed), `/api/apply`,
`/api/logout`, `/llms.txt`.

## Redirects (`apps/web/next.config.ts`)

| Old or guessed address | Goes to |
|---|---|
| `/reconciliation`, `/reconciliation/*` | `/payroll` (permanent; old notifications and bookmarks keep working) |
| `/dashboard`, `/home` | `/` |
| `/employees`, `/staff` | `/settings/employees` |
| `/audit` | `/audit-log` |
| `/my-loans` | `/loans` |

## Adding a page

1. Create `apps/web/src/app/(app)/<name>/page.tsx` and name the folder after the menu label.
2. Add it to `ITEMS` in `nav-links.tsx`, give it a `need`, and add it to the `ROLE_FOCUS` lists that should show it.
3. Add a row above.
