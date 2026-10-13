import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AccessManager, { type AccessPersonView } from "../access-manager";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const removeAccessAction = vi.fn();
const inviteAction = vi.fn();
vi.mock("@/app/(app)/settings/access/actions", () => ({
  changeRoleAction: vi.fn(),
  removeAccessAction: (...a: unknown[]) => removeAccessAction(...a),
  inviteAction: (...a: unknown[]) => inviteAction(...a),
  revokeInviteAction: vi.fn(),
}));

const person = (over: Partial<AccessPersonView>): AccessPersonView => ({
  userId: "u1", email: "a@x.io", name: "Alice Admin", role: "org_admin",
  employeeNo: null, department: null, title: null, isYou: false, ...over,
});

describe("AccessManager", () => {
  beforeEach(() => {
    refresh.mockClear(); removeAccessAction.mockReset(); inviteAction.mockReset();
  });

  test("view-only: shows roles as labels, no controls, no invite form", () => {
    render(<AccessManager canEdit={false} people={[person({}), person({ userId: "u2", name: "Bob", role: "employee" })]} invites={[]} employeesWithoutLogin={[]} />);
    expect(screen.getByText("Alice Admin")).toBeInTheDocument();
    expect(screen.queryByText(/remove access/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/invite someone/i)).not.toBeInTheDocument();
  });

  test("an administrator gets no controls on their own row", () => {
    render(<AccessManager canEdit people={[person({ isYou: true }), person({ userId: "u2", name: "Bob", role: "employee" })]} invites={[]} employeesWithoutLogin={[]} />);
    expect(screen.getByText("You")).toBeInTheDocument();
    // Only Bob's row offers removal.
    expect(screen.getAllByText(/remove access/i)).toHaveLength(1);
  });

  test("removal needs a confirmation, and a refusal from the server is shown", async () => {
    removeAccessAction.mockResolvedValue({ ok: false, error: "This is the organisation's only administrator and can't be removed." });
    render(<AccessManager canEdit people={[person({ isYou: true }), person({ userId: "u2", name: "Bob", role: "org_admin" })]} invites={[]} employeesWithoutLogin={[]} />);
    fireEvent.click(screen.getByText(/remove access/i));
    expect(removeAccessAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    expect(await screen.findByText(/only administrator/i)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  test("inviting sends the email and role, clears the form and refreshes", async () => {
    inviteAction.mockResolvedValue({ ok: true, note: "Invitation sent to aud@x.io." });
    render(<AccessManager canEdit people={[person({ isYou: true })]} invites={[]} employeesWithoutLogin={[]} />);
    fireEvent.change(screen.getByPlaceholderText("name@company.com"), { target: { value: "aud@x.io" } });
    fireEvent.click(screen.getByRole("button", { name: /send invitation/i }));
    await waitFor(() => expect(inviteAction).toHaveBeenCalledWith("aud@x.io", "employee", null));
    expect(await screen.findByText(/invitation sent to aud@x.io/i)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });
});
