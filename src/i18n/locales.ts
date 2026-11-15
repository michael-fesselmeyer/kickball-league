/**
 * The languages the site is written in (ADR 0065). English is the source:
 * every message is written in English first, and a language that lacks a
 * message falls back to it. Each page's language comes from the first
 * segment of its route, `src/app/[lang]`: public addresses carry it in the
 * path (`/es/...`, none for English), and signed-in pages use the person's
 * own setting.
 */
export const LOCALES = ["en", "es"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/** The BCP 47 tag each language formats dates, numbers and money with. */
export const LOCALE_TAGS: Readonly<Record<Locale, string>> = {
  en: "en-US",
  es: "es-US",
};

/** Each language's name in itself, for the language switcher. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  en: "English",
  es: "Español",
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
