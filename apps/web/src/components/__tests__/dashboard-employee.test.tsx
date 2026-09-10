import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DashboardEmployee, { type Mine } from "../dashboard-employee";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe("DashboardEmployee", () => {
  test("shows the apply CTA, not the position card, when there's nothing at all", () => {
    render(<DashboardEmployee mine={null} />);
    expect(screen.getByText(/no loans or applications yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /apply for a loan/i })).toBeInTheDocument();
    expect(screen.queryByText(/outstanding/i)).not.toBeInTheDocument();
  });

  test("makes the outstanding balance the biggest number, with next deduction and progress", () => {
    const mine: Mine = {
      loans: [
        {
          loanId: "loan-1",
          product: "Development Loan",
          principal: 3_000_000,
          outstanding: 1_140_000,
          monthlyDeduction: 275_000,
          nextDueDate: "2026-08-28T00:00:00.000Z",
          progressPct: 62,
        },
      ],
      applicationsInFlight: [],
      eligibility: [],
    };
    render(<DashboardEmployee mine={mine} />);

    expect(screen.getByText("UGX 1,140,000")).toBeInTheDocument();
    expect(screen.getByText("62% repaid")).toBeInTheDocument();
    expect(screen.getByText(/28 Aug/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view schedule/i })).toHaveAttribute("href", "/loans/loan-1");
  });

  test("stacks multiple active loans instead of collapsing them into one figure", () => {
    const mine: Mine = {
      loans: [
        { loanId: "a", product: "Salary Advance", principal: 500_000, outstanding: 200_000, monthlyDeduction: 100_000, nextDueDate: null, progressPct: 60 },
        { loanId: "b", product: "Development Loan", principal: 3_000_000, outstanding: 3_000_000, monthlyDeduction: 90_000, nextDueDate: null, progressPct: 0 },
      ],
      applicationsInFlight: [],
      eligibility: [],
    };
    render(<DashboardEmployee mine={mine} />);
    expect(screen.getByText("UGX 200,000")).toBeInTheDocument();
    expect(screen.getByText("UGX 3,000,000")).toBeInTheDocument();
  });

  test("shows each in-flight application's current approval stage", () => {
    const mine: Mine = {
      loans: [],
      applicationsInFlight: [{ applicationId: "app-1", product: "Staff Car Loan", amount: 20_000_000, stageRole: "cfo" }],
      eligibility: [],
    };
    render(<DashboardEmployee mine={mine} />);
    expect(screen.getByText("Staff Car Loan")).toBeInTheDocument();
    expect(screen.getByText("Cfo stage")).toBeInTheDocument();
  });

  test("lists eligibility as an amount, never a bare pass/fail", () => {
    const mine: Mine = {
      loans: [],
      applicationsInFlight: [{ applicationId: "app-1", product: "x", amount: 1, stageRole: null }],
      eligibility: [{ productId: "p1", productName: "Development Loan", maxAmount: 9_000_000 }],
    };
    render(<DashboardEmployee mine={mine} />);
    expect(screen.getByText("up to UGX 9,000,000")).toBeInTheDocument();
  });
});
