import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LoginForm from "../login-form";
import type { LoginState } from "../page";
import { takeFlash, FLASH_COOKIE } from "@/lib/flash";

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
const toastError = vi.fn();
const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), info: (...a: unknown[]) => toastInfo(...a), success: vi.fn(), warning: vi.fn() },
}));

const action = vi.fn<(prev: LoginState, fd: FormData) => Promise<LoginState>>();
const verify = vi.fn<(prev: LoginState, fd: FormData) => Promise<LoginState>>();
const submit = () => {
  fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "cfo@testco.io" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-pass" } });
  fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
};

describe("sign-in feedback", () => {
  beforeEach(() => {
    replace.mockClear(); refresh.mockClear(); toastError.mockClear(); toastInfo.mockClear(); action.mockReset(); verify.mockReset();
    document.cookie = `${FLASH_COOKIE}=; path=/; max-age=0`;
    render(<LoginForm action={action} verifyAction={verify} tenantName="Test Co" host="testco.localhost" />);
  });

  test("a wrong password shows the message on the form AND pops a toast", async () => {
    action.mockResolvedValue({ error: "Invalid email or password." });
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
    expect(toastError).toHaveBeenCalledWith("Couldn't sign you in", expect.objectContaining({ description: "Invalid email or password." }));
    expect(replace).not.toHaveBeenCalled();
  });

  test("too many attempts is said plainly", async () => {
    action.mockResolvedValue({ error: "Too many attempts. Try again in a few minutes." });
    submit();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][1].description).toMatch(/too many attempts/i);
  });

  test("password right but a code is needed: a toast says so, and nothing claims you are signed in", async () => {
    action.mockResolvedValue({ mfa: { challenge: "c1" } });
    submit();
    await screen.findByLabelText("Code");
    expect(toastInfo).toHaveBeenCalledWith("Password accepted", expect.objectContaining({ description: expect.stringMatching(/authenticator/i) }));
    expect(replace).not.toHaveBeenCalled();
    expect(takeFlash()).toBeNull();
  });

  test("a wrong code pops a toast too", async () => {
    action.mockResolvedValue({ mfa: { challenge: "c1" } });
    verify.mockResolvedValue({ mfa: { challenge: "c1" }, error: "That code isn't right." });
    submit();
    fireEvent.change(await screen.findByLabelText("Code"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /verify and sign in/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("That didn't work", expect.objectContaining({ description: "That code isn't right." })));
  });

  test("a successful sign-in leaves a 'signed in' note for the next page and goes to the app", async () => {
    action.mockResolvedValue({ ok: true });
    submit();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(takeFlash()).toBe("signed-in");
  });
});
