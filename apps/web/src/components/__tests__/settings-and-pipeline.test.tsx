import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MyDetailsForm from "../my-details-form";
import LoanExitPolicy from "../loan-exit-policy";
import PipelinePanel from "../pipeline-panel";
import SecurityPanel from "../security-panel";

const updateMyDetailsAction = vi.fn();
const saveLoanExitPolicyAction = vi.fn();
vi.mock("@/app/(app)/settings/details-actions", () => ({
  updateMyDetailsAction: (...a: unknown[]) => updateMyDetailsAction(...a),
  saveLoanExitPolicyAction: (...a: unknown[]) => saveLoanExitPolicyAction(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(app)/settings/security/actions", () => ({
  startMfaAction: vi.fn(), confirmMfaAction: vi.fn(), disableMfaAction: vi.fn(), newRecoveryCodesAction: vi.fn(), saveMfaPolicyAction: vi.fn(),
}));

const person = { name: "Daniel Ssebunya", email: "cfo@testco.io", employeeNo: "ST001", department: "Finance", title: "CFO", phone: "", location: "", hasRecord: true };

describe("MyDetailsForm", () => {
  beforeEach(() => { updateMyDetailsAction.mockReset(); });

  test("record fields are read-only; only phone and location can be edited", () => {
    render(<MyDetailsForm {...person} />);
    expect(screen.getByLabelText(/full name/i)).toHaveAttribute("readonly");
    expect(screen.getByLabelText(/employee number/i)).toHaveAttribute("readonly");
    expect(screen.getByLabelText(/phone number/i)).not.toHaveAttribute("readonly");
  });

  test("Save is off until something changes, then saves just phone and location", async () => {
    updateMyDetailsAction.mockResolvedValue({ ok: true });
    render(<MyDetailsForm {...person} />);
    const save = screen.getByRole("button", { name: /save changes/i });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "+256 772 123 456" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(updateMyDetailsAction).toHaveBeenCalledWith({ phone: "+256 772 123 456", location: "" }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(save).toBeDisabled(); // nothing left to save
  });

  test("a refusal from the server is shown and nothing claims to be saved", async () => {
    updateMyDetailsAction.mockResolvedValue({ ok: false, field: "phone", error: "Use digits, spaces, + ( ) or -, for example +256 772 123 456." });
    render(<MyDetailsForm {...person} />);
    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText(/use digits/i)).toBeInTheDocument();
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  });

  test("an account with no employee record explains why there is nothing to edit", () => {
    render(<MyDetailsForm {...person} hasRecord={false} />);
    expect(screen.getByText(/isn't linked to an employee record/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phone number/i)).toBeDisabled();
  });
});

describe("LoanExitPolicy", () => {
  beforeEach(() => { saveLoanExitPolicyAction.mockReset(); });

  test("an administrator can switch the policy and save it", async () => {
    saveLoanExitPolicyAction.mockResolvedValue({ ok: true });
    render(<LoanExitPolicy initial="recover_balance" canEdit />);
    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/handle it by hand/i));
    fireEvent.click(save);
    await waitFor(() => expect(saveLoanExitPolicyAction).toHaveBeenCalledWith("manual"));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  test("anyone else sees the choice but cannot change it", () => {
    render(<LoanExitPolicy initial="manual" canEdit={false} />);
    expect(screen.getByLabelText(/handle it by hand/i)).toBeDisabled();
    expect(screen.getByText(/only an administrator/i)).toBeInTheDocument();
  });
});

describe("PipelinePanel", () => {
  const data = [
    { status: "submitted", n: 3, amount: 11_400_000 },
    { status: "in_review", n: 1, amount: 30_000_000 },
    { status: "approved", n: 8, amount: 83_000_000 },
  ];

  test("each stage shows its count and amount, and the shares add up", () => {
    render(<PipelinePanel data={data} currency="UGX" />);
    expect(screen.getByText(/3 applications · UGX 11,400,000/)).toBeInTheDocument();
    expect(screen.getByText(/1 application · UGX 30,000,000/)).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Submitted 3, In review 1, Approved 8, Rejected 0/ })).toBeInTheDocument();
  });

  test("without amounts it shows counts only; with no applications it says so", () => {
    const { rerender } = render(<PipelinePanel data={[{ status: "approved", n: 2 }]} />);
    expect(screen.getByText("2 applications")).toBeInTheDocument();
    rerender(<PipelinePanel data={[]} currency="UGX" />);
    expect(screen.getByText(/no applications yet/i)).toBeInTheDocument();
  });
});

describe("SecurityPanel for the platform console", () => {
  test("uses the actions it is given, and offers no way to turn two-step sign-in off", async () => {
    const start = vi.fn().mockResolvedValue({ ok: true, secret: "ABCDEFGHIJKLMNOP", uri: "otpauth://totp/x" });
    const actions = { start, confirm: vi.fn(), disable: vi.fn(), renew: vi.fn() };
    const { unmount } = render(<SecurityPanel enrolled={false} recoveryCodesLeft={0} keyAvailable requiredForMe setupRequired actions={actions} />);
    fireEvent.click(screen.getByRole("button", { name: /set up two-step/i }));
    await waitFor(() => expect(start).toHaveBeenCalled());
    unmount();
    render(<SecurityPanel enrolled recoveryCodesLeft={10} keyAvailable requiredForMe setupRequired={false} actions={actions} />);
    expect(screen.queryByRole("button", { name: /^turn off$/i })).not.toBeInTheDocument();
  });
});
