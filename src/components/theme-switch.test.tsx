// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeSwitch } from "./theme-switch";
import { en } from "@/i18n/messages/en";

const LABELS = en.shell.theme;

function osPrefersDark(dark: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: dark && query.includes("dark"),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ThemeSwitch", () => {
  it("follows a light OS setting when nothing is saved", () => {
    osPrefersDark(false);
    render(<ThemeSwitch labels={LABELS} />);
    const button = screen.getByRole("button", { name: "Switch to dark mode" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("follows a dark OS setting when nothing is saved", () => {
    osPrefersDark(true);
    render(<ThemeSwitch labels={LABELS} />);
    const button = screen.getByRole("button", { name: "Switch to light mode" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("flips and remembers the theme on each tap", () => {
    osPrefersDark(true);
    render(<ThemeSwitch labels={LABELS} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to light mode" }),
    );
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to dark mode" }),
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    screen.getByRole("button", { name: "Switch to light mode" });
  });

  it("ignores the old stored 'system' choice", () => {
    osPrefersDark(false);
    localStorage.setItem("theme", "system");
    render(<ThemeSwitch labels={LABELS} />);
    screen.getByRole("button", { name: "Switch to dark mode" });
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("puts the saved theme back when the attribute is removed", async () => {
    osPrefersDark(true);
    localStorage.setItem("theme", "light");
    render(<ThemeSwitch labels={LABELS} />);
    expect(document.documentElement.dataset.theme).toBe("light");
    delete document.documentElement.dataset.theme;
    await Promise.resolve();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
