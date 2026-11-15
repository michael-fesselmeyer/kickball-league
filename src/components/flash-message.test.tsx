// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FlashMessage } from "./flash-message";

afterEach(cleanup);

describe("FlashMessage", () => {
  it("is an alert for an error and takes focus so it is read out", () => {
    render(<FlashMessage kind="error">Offer at least one size.</FlashMessage>);
    const message = screen.getByRole("alert");
    expect(message.textContent).toBe("Offer at least one size.");
    expect(document.activeElement).toBe(message);
  });

  it("is a status for a notice and takes focus too", () => {
    render(<FlashMessage kind="notice">Sizes saved.</FlashMessage>);
    const message = screen.getByRole("status");
    expect(document.activeElement).toBe(message);
  });

  it("can be focused by script but is not a tab stop", () => {
    render(<FlashMessage kind="notice">Saved.</FlashMessage>);
    expect(screen.getByRole("status").getAttribute("tabindex")).toBe("-1");
  });

  it("marks an error with the danger border and a notice with success", () => {
    render(
      <>
        <FlashMessage kind="error">Bad.</FlashMessage>
        <FlashMessage kind="notice">Good.</FlashMessage>
      </>,
    );
    expect(screen.getByRole("alert").className).toContain("border-danger");
    expect(screen.getByRole("status").className).toContain("border-success");
  });
});
