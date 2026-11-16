/**
 * What makes the theme button work (src/components/theme-switch.tsx),
 * inlined into every page's <head> as `themeSwitchScript`, so it costs no
 * script file to download (docs/design-system.md, Performance budgets).
 *
 * It must stay self-contained: the page runs its source text, so it may use
 * nothing from outside the function. It works on every
 * `[data-theme-switch]` button, whenever it appears:
 * - a tap flips between light and dark and remembers it on this device;
 * - each button's label and pressed state follow the theme in effect: the
 *   saved one, else the device setting;
 * - React rebuilds <html>'s attributes from the server render, which has no
 *   data-theme, after a server action or a sign-in, and may render the
 *   button afresh; the saved theme and the button's state are put back the
 *   moment that happens, before the browser paints.
 *
 * Returns a function that removes it again, for tests.
 */
export function installThemeSwitch(): () => void {
  const doc = document;
  const root = doc.documentElement;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const saved = () => {
    try {
      const theme = localStorage.getItem("theme");
      return theme === "light" || theme === "dark" ? theme : null;
    } catch {
      return null;
    }
  };
  const dark = () =>
    (root.dataset.theme || (media.matches ? "dark" : "light")) === "dark";
  const sync = () => {
    const theme = saved();
    if (theme && root.dataset.theme !== theme) root.dataset.theme = theme;
    const isDark = dark();
    doc.querySelectorAll<HTMLElement>("[data-theme-switch]").forEach((b) => {
      const label = (isDark ? b.dataset.toLight : b.dataset.toDark) ?? "";
      if (b.getAttribute("aria-label") !== label)
        b.setAttribute("aria-label", label);
      if (b.getAttribute("aria-pressed") !== String(isDark))
        b.setAttribute("aria-pressed", String(isDark));
    });
  };
  const onClick = (event: Event) => {
    const target = event.target as Element | null;
    if (!target?.closest?.("[data-theme-switch]")) return;
    const theme = dark() ? "light" : "dark";
    root.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // Storage blocked: the choice still applies for this page view.
    }
    sync();
  };
  doc.addEventListener("click", onClick);
  media.addEventListener("change", sync);
  window.addEventListener("storage", sync);
  const observer = new MutationObserver(sync);
  observer.observe(root, {
    attributes: true,
    attributeFilter: ["data-theme"],
    childList: true,
    subtree: true,
  });
  sync();
  return () => {
    doc.removeEventListener("click", onClick);
    media.removeEventListener("change", sync);
    window.removeEventListener("storage", sync);
    observer.disconnect();
  };
}

/** `installThemeSwitch`, as the inline script every page's <head> runs. */
export const themeSwitchScript = `(${installThemeSwitch.toString()})()`;
