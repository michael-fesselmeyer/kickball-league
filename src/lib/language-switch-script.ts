/**
 * What makes the footer's language links name the page they are on
 * (src/components/language-switcher.tsx), inlined next to them so it costs
 * no script file to download (docs/design-system.md, Performance budgets).
 *
 * The footer is static and shared by every page, and the client router
 * changes pages without rendering it again, so the path can't be written
 * into the links on the server. Instead, the moment a link is followed
 * (a tap, Enter, or a middle click), its address gets `?from=` and the
 * current path and query, which `/language/<code>` reads before the
 * `Referer` (src/i18n/routing.ts, languageSwitchTarget). Without this
 * script, the link still works from the `Referer`.
 *
 * It must stay self-contained: the page runs its source text, so it may use
 * nothing from outside the function. It installs once per document.
 *
 * Returns a function that removes it again, for tests.
 */
export function installLanguageSwitch(): () => void {
  const doc = document;
  const flag = "kbLanguageSwitch";
  const root = doc.documentElement;
  if (root.dataset[flag]) return () => {};
  root.dataset[flag] = "1";
  const onFollow = (event: Event) => {
    const target = event.target as Element | null;
    const link = target?.closest?.<HTMLAnchorElement>(
      "a[data-language-switch]",
    );
    if (!link) return;
    const from = location.pathname + location.search;
    link.href = `${link.dataset.languageSwitch}?from=${encodeURIComponent(from)}`;
  };
  doc.addEventListener("click", onFollow, true);
  doc.addEventListener("auxclick", onFollow, true);
  return () => {
    doc.removeEventListener("click", onFollow, true);
    doc.removeEventListener("auxclick", onFollow, true);
    delete root.dataset[flag];
  };
}

/** `installLanguageSwitch`, as the inline script the footer runs. */
export const languageSwitchScript = `(${installLanguageSwitch.toString()})()`;
