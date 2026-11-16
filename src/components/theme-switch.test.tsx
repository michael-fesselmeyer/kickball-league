// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/messages/en";
import {
  installThemeSwitch,
  themeSwitchScript,
} from "@/lib/theme-switch-script";
import { ThemeSwitch } from "./theme-switch";

const LABELS = en.shell.theme;

function osPrefersDark(dark: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: dark && query.includes("dark"),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

let uninstall: (() => void) | null = null;

/** The button as the server renders it, with the page's inline script. */
function renderSwitch() {
  render(<ThemeSwitch labels={LABELS} />);
  uninstall = installThemeSwitch();
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  cleanup();
  vi.unstubAllGlobals();
});

describe("ThemeSwitch", () => {
  it("follows a light OS setting when nothing is saved", () => {
    osPrefersDark(false);
    renderSwitch();
    const button = screen.getByRole("button", { name: "Switch to dark mode" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("follows a dark OS setting when nothing is saved", () => {
    osPrefersDark(true);
    renderSwitch();
    const button = screen.getByRole("button", { name: "Switch to light mode" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("flips and remembers the theme on each tap", () => {
    osPrefersDark(true);
    renderSwitch();
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
    renderSwitch();
    screen.getByRole("button", { name: "Switch to dark mode" });
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("puts the saved theme back when the attribute is removed", async () => {
    osPrefersDark(true);
    localStorage.setItem("theme", "light");
    renderSwitch();
    expect(document.documentElement.dataset.theme).toBe("light");
    delete document.documentElement.dataset.theme;
    // The observer runs as a microtask after the change.
    await Promise.resolve();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("brings a button rendered afresh up to date", async () => {
    osPrefersDark(false);
    localStorage.setItem("theme", "dark");
    renderSwitch();
    cleanup();
    render(<ThemeSwitch labels={LABELS} />);
    await Promise.resolve();
    screen.getByRole("button", { name: "Switch to light mode" });
  });

  it("runs from its own source text, as the page inlines it", () => {
    osPrefersDark(true);
    render(<ThemeSwitch labels={LABELS} />);
    // The page runs this text, so it may use nothing outside the function.
    const source = themeSwitchScript.slice(1, -3);
    uninstall = new Function(`return (${source})()`)() as () => void;
    screen.getByRole("button", { name: "Switch to light mode" });
  });
});
