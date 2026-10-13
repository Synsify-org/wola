// Role gates that are shared between a page (what to render) and the server
// action it calls (what to allow). Kept out of the "use server" action files,
// which may only export async functions.

// ---- Privileges: ONE table of who may do what ----------------------------------
// Pages and server actions ask `can(role, "privilege")` (or use the named role lists
// below, which are read from this table). No screen keeps its own list of roles, so
// changing who may do something is one edit here, and a test (permissions.test.ts)
// holds the rules that must never break: the auditor can only look, and nobody who
// approves loans can rewire who approves them.
//
// NOTE: the membership role enum (migration 0001) uses 'org_admin' and 'group_ceo'.
// Older code also referenced 'admin'/'md'; both spellings are kept so a tenant
// provisioned with either gets the right access.

const EXECUTIVES = ["ceo", "md", "coo", "group_ceo"];
const ADMINS = ["admin", "org_admin"];

export const PRIVILEGES = {
  /** Sees the whole organisation's loans and applications. 'auditor' is here (read
   *  access to the whole book) but deliberately NOT in any privilege that acts. */
  "book.view_all": ["cfo", "hr", ...EXECUTIVES, ...ADMINS, "auditor"],
  /** Sees the approvals worklist (adds dept_head, who sees only their reports). */
  "approvals.view": ["cfo", "hr", ...EXECUTIVES, "dept_head", ...ADMINS],
  /** Marks an approved loan as paid out. */
  "loan.disburse": ["cfo", ...EXECUTIVES, ...ADMINS],
  /** Records repayments, runs payroll deductions, pauses and early-repays. */
  "repayment.record": ["cfo", ...EXECUTIVES, ...ADMINS],
  /** Maintains employee data: import, edit, deactivate. */
  "employees.manage": ["hr", "cfo", ...EXECUTIVES, ...ADMINS],
  /** Invites an employee to create their login. Narrower than employees.manage. */
  "accounts.invite": ["hr", ...ADMINS],
  /** Changes a rate index (e.g. the BoU CBR). Executives are deliberately view-only:
   *  a rate change reprices every new loan. */
  "rates.edit": ["cfo", ...ADMINS],
  /** Opens the administration screens and the organisation theme. */
  "config.view": ["cfo", ...EXECUTIVES, ...ADMINS],
  /** Creates/edits/switches off loan products (pricing and eligibility policy). */
  "products.edit": ["cfo", ...ADMINS],
  /** Changes approval routing. Administrators only: the CFO and CEO sit ON the
   *  chains, so they must not rewire who approves their own decisions. */
  "routing.edit": [...ADMINS],
  /** Manages roles and access. Administrators only. */
  "access.edit": [...ADMINS],
  /** Sees the organisation set-up checklist on the dashboard. */
  "setup.view": [...ADMINS],
} as const satisfies Record<string, readonly string[]>;

export type Privilege = keyof typeof PRIVILEGES;

/** May this role do this? Unknown roles and unknown privileges are refused. */
export function can(role: string | null | undefined, privilege: Privilege): boolean {
  return Boolean(role) && (PRIVILEGES[privilege] as readonly string[] | undefined)?.includes(role as string) === true;
}

// Named lists, read from the table above (kept because many call sites use
// `ROLES.includes(ctx.role)`).
export const RATE_INDEX_EDIT_ROLES: string[] = [...PRIVILEGES["rates.edit"]];
export const CONFIG_VIEW_ROLES: string[] = [...PRIVILEGES["config.view"]];
export const PRODUCT_EDIT_ROLES: string[] = [...PRIVILEGES["products.edit"]];
export const ROUTING_EDIT_ROLES: string[] = [...PRIVILEGES["routing.edit"]];
export const ACCESS_EDIT_ROLES: string[] = [...PRIVILEGES["access.edit"]];
export const FULL_BOOK_ROLES: string[] = [...PRIVILEGES["book.view_all"]];
export const APPROVER_ROLES: string[] = [...PRIVILEGES["approvals.view"]];
export const DISBURSER_ROLES: string[] = [...PRIVILEGES["loan.disburse"]];
export const FINANCE_ROLES: string[] = [...PRIVILEGES["repayment.record"]];
export const EMPLOYEE_DATA_ROLES: string[] = [...PRIVILEGES["employees.manage"]];
export const ACCOUNT_CREATOR_ROLES: string[] = [...PRIVILEGES["accounts.invite"]];
export const SETUP_VIEW_ROLES: string[] = [...PRIVILEGES["setup.view"]];

/** What each role is for, in plain words (shown on the Roles & access screen). */
export const ROLE_DESCRIPTION: Record<string, string> = {
  org_admin: "Sets up the organisation: products, approval routing, who has access. Doesn't sit on approval chains.",
  ceo: "Final sign-off on loans; sees the whole book, rejections and reports.",
  group_ceo: "Group-level executive: sees the whole book and signs off where the chain includes them.",
  coo: "Operations executive: sees the whole book; signs off where the chain includes them.",
  cfo: "Owns pricing and the rates; reviews affordability, schedules, disbursement and repayments.",
  hr: "Keeps the employee register accurate and verifies employment before loans go to finance.",
  dept_head: "Approves loans for the people who report to them, and sees only their department.",
  auditor: "Read-only view of the whole book and the audit trail. Cannot act on anything.",
  employee: "Applies for loans and follows their own applications and repayments.",
};
