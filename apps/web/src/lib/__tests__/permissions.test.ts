import { describe, it, expect } from "vitest";
import { PRIVILEGES, can, FINANCE_ROLES, FULL_BOOK_ROLES, ROUTING_EDIT_ROLES, type Privilege } from "../permissions";

const KNOWN = ["cfo", "hr", "ceo", "md", "coo", "group_ceo", "dept_head", "admin", "org_admin", "auditor", "employee"];
const privileges = Object.keys(PRIVILEGES) as Privilege[];

describe("privileges", () => {
  it("only name roles that exist", () => {
    for (const p of privileges) for (const r of PRIVILEGES[p]) expect(KNOWN, `${p} lists unknown role ${r}`).toContain(r);
  });

  it("the auditor can look but never act", () => {
    expect(can("auditor", "book.view_all")).toBe(true);
    for (const p of privileges.filter((x) => x !== "book.view_all")) expect(can("auditor", p), p).toBe(false);
  });

  it("an employee has no privilege at all (their own data is scoped by the data layer, not here)", () => {
    for (const p of privileges) expect(can("employee", p), p).toBe(false);
  });

  it("people who approve loans cannot rewire who approves them", () => {
    for (const r of ["cfo", "ceo", "hr", "dept_head", "coo"]) expect(ROUTING_EDIT_ROLES).not.toContain(r);
  });

  it("only finance-type roles move money", () => {
    for (const r of ["hr", "dept_head", "auditor", "employee"]) expect(FINANCE_ROLES).not.toContain(r);
    expect(FULL_BOOK_ROLES).toContain("auditor");
  });

  it("unknown roles and empty roles are refused", () => {
    expect(can("intern", "book.view_all")).toBe(false);
    expect(can(null, "book.view_all")).toBe(false);
    expect(can("", "loan.disburse")).toBe(false);
  });
});
