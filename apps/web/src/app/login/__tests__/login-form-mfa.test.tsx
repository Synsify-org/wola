import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LoginForm from "../login-form";
import type { LoginState } from "../page";

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const action = vi.fn<(prev: LoginState, fd: FormData) => Promise<LoginState>>();
const verify = vi.fn<(prev: LoginState, fd: FormData) => Promise<LoginState>>();

function renderForm() {
  return render(<LoginForm action={action} verifyAction={verify} tenantName="Test Co" host="testco.localhost" />);
}

async function signInWithPassword() {
  fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "cfo@testco.io" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-pass" } });
  fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
}

describe("LoginForm two-step sign-in", () => {
  beforeEach(() => { replace.mockClear(); refresh.mockClear(); action.mockReset(); verify.mockReset(); });

  test("no second step: a correct password signs straight in", async () => {
    action.mockResolvedValue({ ok: true });
    renderForm();
    await signInWithPassword();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();
  });

  test("password right + two-step on: asks for a code and does NOT navigate yet", async () => {
    action.mockResolvedValue({ mfa: { challenge: "chal-1" } });
    renderForm();
    await signInWithPassword();
    expect(await screen.findByLabelText("Code")).toBeInTheDocument();
    expect(screen.getByText(/Your password is right/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  test("the code is sent with the challenge, and a right code signs in", async () => {
    action.mockResolvedValue({ mfa: { challenge: "chal-1" } });
    verify.mockResolvedValue({ ok: true });
    renderForm();
    await signInWithPassword();
    fireEvent.change(await screen.findByLabelText("Code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /verify and sign in/i }));
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    const fd = verify.mock.calls[0][1];
    expect(fd.get("challenge")).toBe("chal-1");
    expect(fd.get("code")).toBe("123456");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  test("a wrong code shows an error and keeps the code step", async () => {
    action.mockResolvedValue({ mfa: { challenge: "chal-1" } });
    verify.mockResolvedValue({ mfa: { challenge: "chal-1" }, error: "That code isn't right." });
    renderForm();
    await signInWithPassword();
    fireEvent.change(await screen.findByLabelText("Code"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /verify and sign in/i }));
    expect(await screen.findByText("That code isn't right.")).toBeInTheDocument();
    expect(screen.getByLabelText("Code")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  test("too many wrong codes sends the person back to the password step with the reason", async () => {
    action.mockResolvedValue({ mfa: { challenge: "chal-1" } });
    verify.mockResolvedValue({ error: "Too many wrong codes. Sign in again to get a new one." });
    renderForm();
    await signInWithPassword();
    fireEvent.change(await screen.findByLabelText("Code"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /verify and sign in/i }));
    expect(await screen.findByText(/Too many wrong codes/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Password")).toBeInTheDocument());
    expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();
  });

  test("'Use a different account' abandons the challenge", async () => {
    action.mockResolvedValue({ mfa: { challenge: "chal-1" } });
    renderForm();
    await signInWithPassword();
    await screen.findByLabelText("Code");
    fireEvent.click(screen.getByRole("button", { name: /use a different account/i }));
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
  });
});
