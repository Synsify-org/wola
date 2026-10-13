import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import StatCard from "../stat-card";
import Metric from "../metric";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

describe("StatCard", () => {
  test("shows the label, the value and the footer context", () => {
    render(<StatCard label="Total exposure" value="UGX 86,941,882" sub="10 active loans" />);
    expect(screen.getByText("Total exposure")).toBeInTheDocument();
    expect(screen.getByText("UGX 86,941,882")).toBeInTheDocument();
    expect(screen.getByText("10 active loans")).toBeInTheDocument();
  });

  test("a real delta renders as a badge with a spoken direction", () => {
    render(<StatCard label="Interest" value="1" delta={{ dir: "down", pct: 4, note: "vs last month" }} />);
    expect(screen.getByText("4%")).toBeInTheDocument();
    expect(screen.getByText(/down vs last month/)).toBeInTheDocument();
  });

  test("no delta means no badge — nothing is invented", () => {
    render(<StatCard label="Headcount" value="8" />);
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  test("the menu button exists only when real links are given", () => {
    const { rerender } = render(<StatCard label="Exposure" value="1" />);
    expect(screen.queryByRole("button", { name: /more/i })).not.toBeInTheDocument();
    rerender(<StatCard label="Exposure" value="1" menu={[{ label: "Open reports", href: "/reports" }]} />);
    expect(screen.getByRole("button", { name: "Exposure: more" })).toBeInTheDocument();
  });

  test("decorative artwork is hidden from assistive technology", () => {
    const { container } = render(<StatCard label="X" value="1" tone="info" />);
    const svgs = container.querySelectorAll("svg[aria-hidden]");
    expect(svgs.length).toBeGreaterThan(0);
  });
});

describe("Metric (keeps its API on top of StatCard)", () => {
  test("accent maps to a state tone and trend becomes the delta", () => {
    const { container } = render(
      <Metric label="Awaiting you" value="3" accent="awaiting" trend={{ dir: "up", pct: 2, note: "vs last month" }} />,
    );
    expect(screen.getByText("Awaiting you")).toBeInTheDocument();
    expect(screen.getByText("2%")).toBeInTheDocument();
    expect(container.querySelector("[data-slot=card]")?.className).toMatch(/warning-700/);
  });
});
