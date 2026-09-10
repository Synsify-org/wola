import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RateIndexEditor from "../rate-index-editor";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const setRateIndexAction = vi.fn();
vi.mock("@/app/settings/rate-indices-actions", () => ({
  setRateIndexAction: (...args: unknown[]) => setRateIndexAction(...args),
}));

describe("RateIndexEditor", () => {
  beforeEach(() => {
    refresh.mockClear();
    setRateIndexAction.mockClear();
  });

  test("shows the missing-rate-index warning naming the affected products", () => {
    render(
      <RateIndexEditor
        indices={[]}
        productsMissing={[{ id: "p1", name: "Development Loan" }, { id: "p2", name: "Staff Car Loan" }]}
      />,
    );
    expect(screen.getByText(/2 products apply/i)).toBeInTheDocument();
    expect(screen.getByText(/Development Loan, Staff Car Loan/)).toBeInTheDocument();
  });

  test("shows no warning and lists the current value when every product has a rate index", () => {
    render(
      <RateIndexEditor
        indices={[{ name: "CBR", currentValue: 16.5, effectiveFrom: "2026-01-01", productsLinked: 2 }]}
        productsMissing={[]}
      />,
    );
    expect(screen.queryByText(/apply interest but have no rate index/i)).not.toBeInTheDocument();
    expect(screen.getByText("16.500%")).toBeInTheDocument();
    expect(screen.getByText(/since 2026-01-01/)).toBeInTheDocument();
  });

  test("blocks submit with a negative rate, and never calls the action", async () => {
    render(<RateIndexEditor indices={[]} productsMissing={[]} />);
    fireEvent.change(screen.getByPlaceholderText("16.5"), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: /set rate/i }));

    expect(await screen.findByText(/enter a non-negative rate/i)).toBeInTheDocument();
    expect(setRateIndexAction).not.toHaveBeenCalled();
  });

  test("submits the trimmed name and parsed numeric value, then refreshes on success", async () => {
    setRateIndexAction.mockResolvedValue({ ok: true, productsRepointed: 2 });
    render(<RateIndexEditor indices={[]} productsMissing={[]} />);

    fireEvent.change(screen.getByPlaceholderText("CBR"), { target: { value: "  CBR  " } });
    fireEvent.change(screen.getByPlaceholderText("16.5"), { target: { value: "17.25" } });
    fireEvent.click(screen.getByRole("button", { name: /set rate/i }));

    await waitFor(() => expect(setRateIndexAction).toHaveBeenCalledWith("CBR", 17.25));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  test("surfaces the server's error message instead of a generic one", async () => {
    setRateIndexAction.mockResolvedValue({ ok: false, error: "Rate must be zero or positive." });
    render(<RateIndexEditor indices={[]} productsMissing={[]} />);

    fireEvent.change(screen.getByPlaceholderText("16.5"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /set rate/i }));

    expect(await screen.findByText("Rate must be zero or positive.")).toBeInTheDocument();
  });
});
