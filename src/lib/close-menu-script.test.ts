// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installCloseMenuOnLink } from "./close-menu-script";

/** A popover menu with a link and a plain button, open. */
function menu() {
  document.body.innerHTML = `
    <div id="m" popover="auto"><a href="/faq">FAQ</a><button>Close</button></div>
    <a id="outside" href="/about">About</a>`;
  const el = document.getElementById("m") as HTMLElement;
  // jsdom has no popover API: stand in for an open menu.
  el.matches = (selector: string) => selector === ":popover-open";
  el.hidePopover = vi.fn();
  return el;
}

describe("closeMenuOnLink", () => {
  let remove = () => {};
  afterEach(() => remove());

  it("closes an open menu when one of its links is followed", () => {
    remove = installCloseMenuOnLink();
    const el = menu();
    el.querySelector("a")?.addEventListener("click", (e) => e.preventDefault());
    el.querySelector("a")?.click();
    expect(el.hidePopover).toHaveBeenCalledOnce();
  });

  it("leaves it open for anything else", () => {
    remove = installCloseMenuOnLink();
    const el = menu();
    el.querySelector("button")?.click();
    const outside = document.getElementById("outside") as HTMLElement;
    outside.addEventListener("click", (e) => e.preventDefault());
    outside.click();
    expect(el.hidePopover).not.toHaveBeenCalled();
  });
});
