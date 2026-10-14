import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DashboardAdmin, { type ConfigurationStatus } from "../dashboard-admin";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const readyStatus: ConfigurationStatus = {
  productsCount: 3,
  pipelinesCount: 3,
  productsWithoutPipeline: [],
  productsMissingRateIndex: [],
  stagesWithoutHolder: [],
  usersCount: 12,
};

describe("DashboardAdmin", () => {
  test("shows every checklist item as done when the tenant is fully configured", () => {
    render(<DashboardAdmin status={readyStatus} />);
    expect(screen.getByText("Loan products defined (3)")).toBeInTheDocument();
    expect(screen.getByText("Approval routing set up (3)")).toBeInTheDocument();
    expect(screen.getByText("Rate index set for every interest-bearing product")).toBeInTheDocument();
    // No "Configure"/"Set" action links when everything's ready.
    expect(screen.queryByRole("link", { name: /configure/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^set$/i })).not.toBeInTheDocument();
  });

  test("flags a product missing a pipeline, with a fix link, instead of showing it as done", () => {
    const status: ConfigurationStatus = {
      ...readyStatus,
      productsWithoutPipeline: [{ id: "p1", name: "Staff Car Loan" }],
    };
    render(<DashboardAdmin status={status} />);
    expect(screen.getByText("1 product with no approvers")).toBeInTheDocument();
    expect(screen.queryByText("Approval routing set up (3)")).not.toBeInTheDocument();
  });

  test("flags products missing a rate index by count", () => {
    const status: ConfigurationStatus = {
      ...readyStatus,
      productsMissingRateIndex: [{ id: "p1", name: "Development Loan" }, { id: "p2", name: "Staff Car Loan" }],
    };
    render(<DashboardAdmin status={status} />);
    expect(screen.getByText("2 products missing a rate index")).toBeInTheDocument();
  });

  test("warns when an approval step has nobody to act on it, and says whose loans will wait", () => {
    const status: ConfigurationStatus = {
      ...readyStatus,
      stagesWithoutHolder: [{ role: "group_ceo", products: ["Development Loan", "Staff Car Loan"], appliesTo: ["ceo"] }],
    };
    render(<DashboardAdmin status={status} />);
    expect(screen.getByText(/Nobody holds the .*role, so Development Loan, Staff Car Loan \(when the .* applies\) will wait at that step/i)).toBeInTheDocument();
    expect(screen.queryByText("Every approval step has someone who can act on it")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /invite/i })).toHaveAttribute("href", "/settings/access");
  });

  test("a chain where everyone applies, with nobody holding a step, is not described as only the CEO's", () => {
    const status: ConfigurationStatus = { ...readyStatus, stagesWithoutHolder: [{ role: "coo", products: ["Salary Advance"], appliesTo: ["default", "ceo"] }] };
    render(<DashboardAdmin status={status} />);
    expect(screen.getByText(/Nobody holds the .*role, so Salary Advance will wait at that step/i)).toBeInTheDocument();
  });

  test("never renders an approval queue — administration and approval stay separate duties", () => {
    render(<DashboardAdmin status={readyStatus} />);
    expect(screen.queryByText(/needs your decision/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
  });

  test("surfaces users & roles count and a read-only book link", () => {
    render(<DashboardAdmin status={readyStatus} />);
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /loan book/i })).toHaveAttribute("href", "/book");
  });
});
