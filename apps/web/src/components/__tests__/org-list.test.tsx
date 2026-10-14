import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import OrgList from "../admin/org-list";
import type { OrgSummary } from "@wola/db";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const org = (over: Partial<OrgSummary>): OrgSummary => ({
  id: "id-1", slug: "acme", name: "Acme Steel", plan: "standard", status: "active", currency: "UGX", createdAt: "2026-09-01T00:00:00Z",
  people: 12, employees: 10, activeLoans: 4, principal: 5_000_000, outstanding: 3_000_000, arrearsLoans: 0, arrears: 0, inFlight: 1,
  emailsPending: 0, emailsFailed: 0, emailsSent7d: 0, oldestPendingAt: null, admins: 1, mfaRoles: 0, lastActivityAt: null, lastSignInAt: null, ...over,
});

const ORGS = [
  org({}),
  org({ id: "id-2", slug: "nile", name: "Nile Textiles", status: "suspended", arrearsLoans: 2, outstanding: 0, activeLoans: 0 }),
];

describe("OrgList", () => {
  test("lists every organisation with a link to its own page", () => {
    render(<OrgList orgs={ORGS} />);
    // Rendered as a table (wide screens) and as cards (phones): both link to the page.
    const links = screen.getAllByRole("link", { name: /Acme Steel/ });
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0]).toHaveAttribute("href", "/admin/tenants/id-1");
  });

  test("search narrows by name, address or status", () => {
    render(<OrgList orgs={ORGS} />);
    fireEvent.change(screen.getByRole("searchbox", { name: /search organisations/i }), { target: { value: "suspended" } });
    expect(screen.queryAllByText(/Acme Steel/)).toHaveLength(0);
    expect(screen.getAllByText(/Nile Textiles/).length).toBeGreaterThan(0);
  });

  test("nothing matching says so; an empty platform says that instead", () => {
    const { unmount } = render(<OrgList orgs={ORGS} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect(screen.getByText(/no organisation matches/i)).toBeInTheDocument();
    unmount();
    render(<OrgList orgs={[]} />);
    expect(screen.getByText(/no organisations have been onboarded/i)).toBeInTheDocument();
  });

  test("loans behind on payments are called out", () => {
    render(<OrgList orgs={ORGS} />);
    const table = screen.getAllByRole("table")[0];
    const row = within(table).getByText("Nile Textiles").closest("tr")!;
    expect(within(row).getByText("2")).toHaveClass("text-rejected");
  });
});
