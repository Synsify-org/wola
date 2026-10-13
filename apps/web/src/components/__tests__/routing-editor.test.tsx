import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RoutingEditor, { type ProductRoutingView } from "../routing-editor";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const saveChainAction = vi.fn();
vi.mock("@/app/(app)/settings/routing/actions", () => ({
  saveChainAction: (...a: unknown[]) => saveChainAction(...a),
}));

const stage = (id: string, role: string) => ({ id, role, slaHours: null, allowDelegation: true });
const product = (over: Partial<ProductRoutingView> = {}): ProductRoutingView => ({
  productId: "p1",
  productName: "Development Loan",
  active: true,
  inReview: 0,
  chains: [{ appliesTo: "default", stages: [stage("s1", "hr"), stage("s2", "cfo"), stage("s3", "ceo")] }],
  ...over,
});

describe("RoutingEditor", () => {
  beforeEach(() => {
    refresh.mockClear();
    saveChainAction.mockReset();
  });

  test("shows the standard chain in order", () => {
    render(<RoutingEditor product={product()} canEdit />);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items.join("|")).toMatch(/1HR.*2CFO.*3CEO/);
  });

  test("view-only users get no Edit button", () => {
    render(<RoutingEditor product={product()} canEdit={false} />);
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });

  test("a product with no chain says nobody can approve it", () => {
    render(<RoutingEditor product={product({ chains: [] })} canEdit />);
    expect(screen.getByText(/can.t be approved yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /set up/i })).toBeInTheDocument();
  });

  test("with applications in review the approvers are locked, with an explanation", () => {
    render(<RoutingEditor product={product({ inReview: 2 })} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByText(/still in review/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /move up/i })[1]).toBeDisabled();
    expect(screen.queryByText(/add an approver/i)).not.toBeInTheDocument();
  });

  test("saving sends the stages in order and refreshes", async () => {
    saveChainAction.mockResolvedValue({ ok: true, message: "Saved." });
    render(<RoutingEditor product={product()} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.change(screen.getByLabelText(/time limit in hours for stage 2/i), { target: { value: "24" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(saveChainAction).toHaveBeenCalledTimes(1));
    expect(saveChainAction).toHaveBeenCalledWith("p1", "default", [
      { role: "hr", slaHours: null, allowDelegation: true },
      { role: "cfo", slaHours: 24, allowDelegation: true },
      { role: "ceo", slaHours: null, allowDelegation: true },
    ]);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  test("a server refusal is shown, not swallowed", async () => {
    saveChainAction.mockResolvedValue({ ok: false, error: "2 applications are still in review." });
    render(<RoutingEditor product={product()} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /remove approver/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/2 applications are still in review/)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
