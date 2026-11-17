// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormError } from "./form-error";

afterEach(cleanup);

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
});

describe("FormError", () => {
  it("renders nothing without a message", () => {
    const { container } = render(<FormError message={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("is an alert that takes focus and scrolls into view", () => {
    render(<FormError message="Check the fields marked below." />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Check the fields marked below.");
    expect(document.activeElement).toBe(alert);
    expect(alert.getAttribute("tabindex")).toBe("-1");
    expect(alert.scrollIntoView).toHaveBeenCalled();
  });

  it("takes focus again on a new attempt with the same message", () => {
    const first = {};
    const { rerender } = render(
      <FormError message="Check the fields." attempt={first} />,
    );
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    rerender(<FormError message="Check the fields." attempt={{}} />);
    expect(document.activeElement).toBe(screen.getByRole("alert"));
  });
});
