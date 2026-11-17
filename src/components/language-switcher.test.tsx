// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  installLanguageSwitch,
  languageSwitchScript,
} from "@/lib/language-switch-script";
import { LanguageSwitcher } from "./language-switcher";

let uninstall: (() => void) | null = null;

afterEach(() => {
  uninstall?.();
  uninstall = null;
  cleanup();
  history.replaceState(null, "", "/");
});

/** The links as the server renders them, with their inline script. */
function renderLinks() {
  render(<LanguageSwitcher current="es" label="Language" />);
  uninstall = installLanguageSwitch();
}

const follow = (link: HTMLElement) => {
  // Stop jsdom from trying to navigate; the address is what's checked.
  link.addEventListener("click", (e) => e.preventDefault(), { once: true });
  link.click();
  return link.getAttribute("href");
};

describe("LanguageSwitcher", () => {
  it("renders plain links that work without the script", () => {
    render(<LanguageSwitcher current="es" label="Language" />);
    expect(
      screen.getByRole("link", { name: "English" }).getAttribute("href"),
    ).toBe("/language/en");
  });

  it("names the page the visitor is on as the link is followed", () => {
    renderLinks();
    history.replaceState(null, "", "/es/faq?x=1");
    expect(follow(screen.getByRole("link", { name: "English" }))).toBe(
      `/language/en?from=${encodeURIComponent("/es/faq?x=1")}`,
    );
  });

  it("follows the client router to whatever page is current", () => {
    renderLinks();
    history.replaceState(null, "", "/faq");
    const link = screen.getByRole("link", { name: "Español" });
    expect(follow(link)).toBe("/language/es?from=%2Ffaq");
    history.pushState(null, "", "/help");
    expect(follow(link)).toBe("/language/es?from=%2Fhelp");
  });

  it("installs once, however many times the footer renders", () => {
    renderLinks();
    // A second copy does nothing, so removing it leaves the first working.
    installLanguageSwitch()();
    history.replaceState(null, "", "/faq");
    expect(follow(screen.getByRole("link", { name: "Español" }))).toBe(
      "/language/es?from=%2Ffaq",
    );
    expect(languageSwitchScript).toContain("data-language-switch");
  });
});
