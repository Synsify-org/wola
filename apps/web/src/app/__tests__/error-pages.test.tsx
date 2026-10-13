import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AppError from "../(app)/error";
import RootError from "../error";
import GlobalError from "../global-error";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

// A failure must never show a stack trace or a technical message: only a plain
// sentence, a way to retry, and the reference number support can look up.
const boom = Object.assign(new Error('relation "secret_table" does not exist at /srv/app/db.ts:41'), { digest: "3234606282" });

describe.each([
  ["in-app error page", () => <AppError error={boom} reset={() => {}} />],
  ["public error page", () => <RootError error={boom} reset={() => {}} />],
])("%s", (_name, ui) => {
  test("shows a friendly message and the reference, and leaks nothing technical", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(ui());
    expect(container.textContent).not.toMatch(/secret_table|\/srv\/app|db\.ts|relation|Error:/);
    expect(screen.getByText("3234606282")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(container.textContent).toMatch(/nothing you entered has been submitted/i);
  });

  test("Try again calls reset", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    const Comp = _name.startsWith("in-app") ? AppError : RootError;
    render(<Comp error={boom} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe("global error (the root layout itself failed)", () => {
  test("is self-contained, friendly and leak-free", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<GlobalError error={boom} reset={() => {}} />, { container: document.createElement("div") });
    expect(container.textContent).not.toMatch(/secret_table|\/srv\/app/);
    expect(container.textContent).toContain("3234606282");
  });
});
