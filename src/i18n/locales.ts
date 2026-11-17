/**
 * The languages the site is written in (ADR 0094). English is the source:
 * every message is written in English first, and a language that lacks a
 * message falls back to it. Each page's language comes from the first
 * segment of its route, `src/app/[lang]`: public addresses carry it in the
 * path (`/es/...`, none for English), and signed-in pages use the person's
 * own setting.
 */
export const LOCALES = [
  "en",
  "es",
  "zh",
  "ru",
  "pl",
  "bn",
  "ko",
  "ht",
  "it",
  "fr",
] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/**
 * The BCP 47 tag each language formats dates, numbers and money with.
 * Chinese is Simplified. Bengali keeps Western digits, as the scores, times
 * and prices around them use. The formatting data has no Haitian Creole, so
 * `ht` reads dates through French and swaps in the Creole day and month
 * names (`src/domain/time/format-cache.ts`).
 */
export const LOCALE_TAGS: Readonly<Record<Locale, string>> = {
  en: "en-US",
  es: "es-US",
  zh: "zh-Hans",
  ru: "ru",
  pl: "pl",
  bn: "bn-u-nu-latn",
  ko: "ko",
  ht: "ht",
  it: "it-IT",
  fr: "fr-FR",
};

/**
 * The tag a page's `lang` attribute and its `hreflang` links use. The
 * address keeps the short code (`/zh/...`); the tag says which script.
 */
export const LANG_ATTRIBUTES: Readonly<Record<Locale, string>> = {
  en: "en",
  es: "es",
  zh: "zh-Hans",
  ru: "ru",
  pl: "pl",
  bn: "bn",
  ko: "ko",
  ht: "ht",
  it: "it",
  fr: "fr",
};

/** Each language's name in itself, for the language switcher. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  en: "English",
  es: "Español",
  zh: "简体中文",
  ru: "Русский",
  pl: "Polski",
  bn: "বাংলা",
  ko: "한국어",
  ht: "Kreyòl ayisyen",
  it: "Italiano",
  fr: "Français",
};

/** The Open Graph locale of each language's pages. */
export const OPEN_GRAPH_LOCALES: Readonly<Record<Locale, string>> = {
  en: "en_US",
  es: "es_US",
  zh: "zh_CN",
  ru: "ru_RU",
  pl: "pl_PL",
  bn: "bn_BD",
  ko: "ko_KR",
  ht: "ht_HT",
  it: "it_IT",
  fr: "fr_FR",
};

/**
 * Languages the signed-in pages are shown in. Until the app's screens are
 * translated, everyone sees them in English; emails and push already follow
 * the person's own language.
 */
export const SIGNED_IN_LOCALES: readonly Locale[] = ["en"];

/** The address prefix of a language's public pages: "" for English. */
export function localePrefix(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? "" : `/${locale}`;
}

/** `path` (starting with "/") as `locale` serves it. */
export function localizedPath(locale: Locale, path: string): string {
  const prefix = localePrefix(locale);
  if (!prefix) return path;
  return path === "/" ? prefix : `${prefix}${path}`;
}
