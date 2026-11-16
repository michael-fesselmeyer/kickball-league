import { DEFAULT_LOCALE, LOCALES, type Locale } from "./locales";

/**
 * Which public pages each language is served for (ADR 0094). A page joins
 * a language once all its words are translated, so a visitor never lands
 * on a half-translated page: `/es/x` for a page not listed here goes to
 * the English page, and only listed pages get `hreflang` links and
 * sitemap entries in that language. English serves every page.
 *
 * Patterns are public paths without a language prefix; `*` stands for one
 * path segment, such as a season's slug. A league's pages match the same
 * way under its `/l/<slug>` prefix.
 */
export const TRANSLATED_PAGES: Readonly<Record<Locale, readonly string[]>> = {
  // English is the source: every page, whatever this says.
  en: [],
  es: [
    "/",
    "/faq",
    "/seasons/*/schedule",
    "/about",
    "/parks/mccarren-park",
    "/seasons/*/standings",
    "/teams/*",
    "/games/*",
    "/events",
    "/sponsors",
    "/sponsors/*",
    "/help",
    "/help/player",
    "/help/captain",
    "/help/ref",
  ],
};

const compiled = new Map<string, RegExp>();

function matcher(pattern: string): RegExp {
  let found = compiled.get(pattern);
  if (!found) {
    const body = pattern
      .split("/")
      .map((part) =>
        part === "*" ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      )
      .join("/");
    // The same page in another league: /l/<slug> then the page's path.
    found = new RegExp(
      `^(?:/l/[a-z0-9]+(?:-[a-z0-9]+)*)?${body === "/" ? "/?" : body}$`,
    );
    compiled.set(pattern, found);
  }
  return found;
}

/** Whether a public path is the page a TRANSLATED_PAGES pattern names. */
export function matchesPage(pattern: string, path: string): boolean {
  return matcher(pattern).test(path);
}

/** Whether `path` (a public path, no language prefix) is served in `locale`. */
export function isTranslated(locale: Locale, path: string): boolean {
  if (locale === DEFAULT_LOCALE) return true;
  const clean = path.length > 1 ? path.replace(/\/$/, "") : path;
  return TRANSLATED_PAGES[locale].some((p) => matchesPage(p, clean));
}

/** The languages `path` is served in, English first. */
export function localesOf(path: string): Locale[] {
  return LOCALES.filter((locale) => isTranslated(locale, path));
}

/**
 * The languages the footer offers: English, and each language with at least
 * one translated page. Fewer than two, and the footer offers none.
 */
export function offeredLocales(): Locale[] {
  return LOCALES.filter(
    (locale) =>
      locale === DEFAULT_LOCALE || TRANSLATED_PAGES[locale].length > 0,
  );
}
