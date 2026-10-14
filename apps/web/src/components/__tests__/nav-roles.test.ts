import { describe, test, expect, vi } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { visibleNavItems, ROLE_FOCUS } from "../nav-links";
import { FULL_BOOK_ROLES, APPROVER_ROLES, ROLE_DESCRIPTION } from "@/lib/permissions";

vi.mock("next/link", () => ({ default: () => null, useLinkStatus: () => ({ pending: false }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const menu = (role: string) => visibleNavItems(role, FULL_BOOK_ROLES.includes(role), APPROVER_ROLES.includes(role));
const hrefs = (role: string) => menu(role).map((i) => i.href);
const labels = (role: string) => menu(role).map((i) => i.label);

describe("role-specific navigation", () => {
  test("every role has its own menu: none falls back to 'everything'", () => {
    for (const role of Object.keys(ROLE_DESCRIPTION)) expect(ROLE_FOCUS[role], `${role} has no menu defined`).toBeDefined();
  });

  test("the CEO oversees: book, reports, audit log; no payroll and no staff register", () => {
    expect(hrefs("ceo")).toEqual(expect.arrayContaining(["/book", "/reports", "/audit-log", "/approvals"]));
    expect(hrefs("ceo")).not.toContain("/payroll");
    expect(hrefs("ceo")).not.toContain("/settings/employees");
  });

  test("the CFO runs the money: payroll, book, reports, audit log", () => {
    expect(hrefs("cfo")).toEqual(expect.arrayContaining(["/payroll", "/book", "/reports", "/audit-log", "/analytics"]));
    expect(hrefs("cfo")).not.toContain("/settings/employees");
  });

  test("HR keeps the register: employees and approvals; no payroll, no audit log", () => {
    expect(hrefs("hr")).toEqual(expect.arrayContaining(["/settings/employees", "/approvals"]));
    expect(hrefs("hr")).not.toContain("/payroll");
    expect(hrefs("hr")).not.toContain("/audit-log");
  });

  test("an administrator sets up and looks after people, and sits on no approval chain", () => {
    for (const role of ["org_admin", "admin"]) {
      expect(hrefs(role)).toContain("/settings/employees");
      expect(hrefs(role)).not.toContain("/approvals");
      expect(hrefs(role)).not.toContain("/payroll");
    }
  });

  test("the auditor only reads: nothing to apply for, approve or run", () => {
    expect(hrefs("auditor")).toEqual(expect.arrayContaining(["/book", "/reports", "/audit-log"]));
    for (const h of ["/apply", "/approvals", "/payroll", "/settings/employees"]) expect(hrefs("auditor")).not.toContain(h);
  });

  test("an employee sees four things; a department head sees their department, labelled so", () => {
    expect(hrefs("employee")).toEqual(["/", "/apply", "/applications", "/loans"]);
    expect(labels("employee")).toContain("My applications");
    expect(labels("dept_head")).toContain("Department");
    expect(hrefs("dept_head")).toContain("/approvals");
  });

  test("no menu is longer than it needs to be: the busiest role has fewer than the old twelve", () => {
    for (const role of Object.keys(ROLE_FOCUS)) expect(menu(role).length, role).toBeLessThan(12);
  });

  test("a menu never offers a page the role may not open (focus only ever narrows access)", () => {
    for (const role of Object.keys(ROLE_FOCUS)) {
      const allowed = visibleNavItems("__everything__", FULL_BOOK_ROLES.includes(role), APPROVER_ROLES.includes(role)).map((i) => i.href);
      for (const h of hrefs(role)) expect(allowed, `${role} is offered ${h}`).toContain(h);
    }
  });

  test("an unknown future role still gets a working menu (everything it may open)", () => {
    expect(visibleNavItems("treasurer", false, false).map((i) => i.href)).toEqual(["/", "/apply", "/applications", "/loans"]);
  });

  test("every link in every menu points at a page that exists", () => {
    const appDir = path.resolve(__dirname, "../../app/(app)");
    for (const role of Object.keys(ROLE_FOCUS)) {
      for (const h of hrefs(role)) {
        const file = path.join(appDir, h === "/" ? "" : h, "page.tsx");
        expect(existsSync(file), `${role}: ${h} has no page at ${file}`).toBe(true);
      }
    }
  });
});
