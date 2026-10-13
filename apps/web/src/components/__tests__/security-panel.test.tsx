import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SecurityPanel, { MfaPolicyPanel } from "../security-panel";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const startMfaAction = vi.fn();
const confirmMfaAction = vi.fn();
const disableMfaAction = vi.fn();
const newRecoveryCodesAction = vi.fn();
const saveMfaPolicyAction = vi.fn();
vi.mock("@/app/(app)/settings/security/actions", () => ({
  startMfaAction: (...a: unknown[]) => startMfaAction(...a),
  confirmMfaAction: (...a: unknown[]) => confirmMfaAction(...a),
  disableMfaAction: (...a: unknown[]) => disableMfaAction(...a),
  newRecoveryCodesAction: (...a: unknown[]) => newRecoveryCodesAction(...a),
  saveMfaPolicyAction: (...a: unknown[]) => saveMfaPolicyAction(...a),
}));

const base = { enrolled: false, recoveryCodesLeft: 0, keyAvailable: true, requiredForMe: false, setupRequired: false };

describe("SecurityPanel", () => {
  beforeEach(() => { refresh.mockClear(); [startMfaAction, confirmMfaAction, disableMfaAction, newRecoveryCodesAction, saveMfaPolicyAction].forEach((m) => m.mockReset()); });

  test("server not configured: explains, offers no setup button", () => {
    render(<SecurityPanel {...base} keyAvailable={false} />);
    expect(screen.getByText(/isn't switched on for this server yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /set up two-step/i })).not.toBeInTheDocument();
  });

  test("a person sent here because it's required is told why", () => {
    render(<SecurityPanel {...base} requiredForMe setupRequired />);
    expect(screen.getByText(/requires two-step sign-in for your role/i)).toBeInTheDocument();
  });

  test("setup: shows the key (grouped), then the recovery codes after a right code", async () => {
    startMfaAction.mockResolvedValue({ ok: true, secret: "ABCDEFGHIJKLMNOP", uri: "otpauth://totp/x" });
    confirmMfaAction.mockResolvedValue({ ok: true, recoveryCodes: ["AAAAA-BBBBB", "CCCCC-DDDDD"] });
    render(<SecurityPanel {...base} />);
    fireEvent.click(screen.getByRole("button", { name: /set up two-step/i }));
    expect(await screen.findByText("ABCD EFGH IJKL MNOP")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("123 456"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /^turn on$/i }));
    await waitFor(() => expect(confirmMfaAction).toHaveBeenCalledWith("123456"));
    expect(await screen.findByText("AAAAA-BBBBB")).toBeInTheDocument();
    // Can't dismiss until the person confirms they saved them.
    expect(screen.getByRole("button", { name: /^done$/i })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I've saved these codes/i));
    expect(screen.getByRole("button", { name: /^done$/i })).toBeEnabled();
  });

  test("a wrong setup code shows the server's message and stays on the setup screen", async () => {
    startMfaAction.mockResolvedValue({ ok: true, secret: "ABCDEFGHIJKLMNOP", uri: "otpauth://totp/x" });
    confirmMfaAction.mockResolvedValue({ ok: false, error: "That code isn't right." });
    render(<SecurityPanel {...base} />);
    fireEvent.click(screen.getByRole("button", { name: /set up two-step/i }));
    await screen.findByText("ABCD EFGH IJKL MNOP");
    fireEvent.change(screen.getByPlaceholderText("123 456"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /^turn on$/i }));
    expect(await screen.findByText("That code isn't right.")).toBeInTheDocument();
  });

  test("enrolled: shows how many recovery codes are left and warns when low", () => {
    render(<SecurityPanel {...base} enrolled recoveryCodesLeft={1} />);
    expect(screen.getByText("On")).toBeInTheDocument();
    expect(screen.getByText(/running low on recovery codes/i)).toBeInTheDocument();
  });

  test("required for this role: no way to turn it off", () => {
    render(<SecurityPanel {...base} enrolled recoveryCodesLeft={8} requiredForMe />);
    expect(screen.queryByRole("button", { name: /^turn off$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/requires this for your role/i)).toBeInTheDocument();
  });

  test("turning off needs a code, which is sent to the server", async () => {
    disableMfaAction.mockResolvedValue({ ok: true });
    render(<SecurityPanel {...base} enrolled recoveryCodesLeft={8} />);
    fireEvent.click(screen.getByRole("button", { name: /^turn off$/i }));
    fireEvent.change(screen.getByPlaceholderText("123 456"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: /turn off two-step sign-in/i }));
    await waitFor(() => expect(disableMfaAction).toHaveBeenCalledWith("654321"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe("MfaPolicyPanel", () => {
  beforeEach(() => saveMfaPolicyAction.mockReset());

  test("save is disabled until something changes, then sends the chosen roles", async () => {
    saveMfaPolicyAction.mockResolvedValue({ ok: true });
    render(<MfaPolicyPanel initial={["cfo"]} keyAvailable />);
    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Administrator"));
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(saveMfaPolicyAction).toHaveBeenCalledTimes(1));
    expect(new Set(saveMfaPolicyAction.mock.calls[0][0])).toEqual(new Set(["cfo", "org_admin"]));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  test("without a server key the policy can't be edited", () => {
    render(<MfaPolicyPanel initial={[]} keyAvailable={false} />);
    expect(screen.getByLabelText("Administrator")).toBeDisabled();
  });
});
