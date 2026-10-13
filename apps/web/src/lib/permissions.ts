// Role gates that are shared between a page (what to render) and the server
// action it calls (what to allow). Kept out of the "use server" action files,
// which may only export async functions.

/** Who may CHANGE a rate index (e.g. the BoU CBR). Everyone with the
 *  administration view can SEE it; the CEO and other executives are
 *  deliberately view-only — a rate change reprices every new loan. */
export const RATE_INDEX_EDIT_ROLES = ["cfo", "admin", "org_admin"];

/** Who may OPEN the administration screens (products, approval routing, rates).
 *  Everyone here can see the configuration; only the roles below can change it. */
export const CONFIG_VIEW_ROLES = ["cfo", "ceo", "md", "coo", "group_ceo", "admin", "org_admin"];

/** Who may create/edit/switch off loan products. Pricing and eligibility
 *  policy: the CFO owns it alongside administrators. Executives who approve
 *  loans (CEO, COO, ...) can see products but not reshape them. */
export const PRODUCT_EDIT_ROLES = ["cfo", "admin", "org_admin"];

/** Who may change approval routing. Administrators only — the CFO and CEO sit
 *  ON the chains, so they must not be able to rewire who approves their own
 *  decisions (administration and approval stay separate duties). */
export const ROUTING_EDIT_ROLES = ["admin", "org_admin"];

/** Who may manage roles and access (change roles, remove access, invite any
 *  role). Administrators only. (HR can still invite an employee to log in, from
 *  the employee directory — see ACCOUNT_CREATOR_ROLES.) */
export const ACCESS_EDIT_ROLES = ["admin", "org_admin"];

// ---- Shared role sets ------------------------------------------------------
// ONE definition each, used by the guard, the pages and the Roles & access
// screen, so what that screen shows is what the system enforces.
//
// NOTE: the membership role enum (migration 0001) uses 'org_admin' and
// 'group_ceo'. Older code also referenced 'admin'/'md'; both spellings are kept
// so a tenant provisioned with either gets the right access.

/** Whole-organisation data. 'auditor' is here (read access to the whole book)
 *  but deliberately NOT in APPROVER_ROLES, and must never be added to
 *  DISBURSER_ROLES / FINANCE_ROLES — oversight, not action. */
export const FULL_BOOK_ROLES = ["cfo", "hr", "ceo", "md", "coo", "group_ceo", "admin", "org_admin", "auditor"];
/** Sees the approvals worklist (adds dept_head, who sees only their reports). */
export const APPROVER_ROLES = ["cfo", "hr", "ceo", "md", "coo", "group_ceo", "dept_head", "admin", "org_admin"];
/** Marks an approved loan as paid out. */
export const DISBURSER_ROLES = ["cfo", "ceo", "md", "coo", "group_ceo", "admin", "org_admin"];
/** Records repayments against a loan. */
export const FINANCE_ROLES = ["cfo", "ceo", "md", "coo", "group_ceo", "admin", "org_admin"];
/** Maintains employee data: import, edit, deactivate. */
export const EMPLOYEE_DATA_ROLES = ["hr", "cfo", "ceo", "md", "coo", "group_ceo", "admin", "org_admin"];
/** Invites an employee to create their login. Narrower than EMPLOYEE_DATA_ROLES. */
export const ACCOUNT_CREATOR_ROLES = ["hr", "admin", "org_admin"];

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
