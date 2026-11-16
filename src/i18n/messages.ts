import { type Complete, type Translation, withFallback } from "./catalog";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./locales";
import { type EnglishMessages, en } from "./messages/en";
import { bn } from "./messages/bn";
import { es } from "./messages/es";
import { ht } from "./messages/ht";
import { ko } from "./messages/ko";
import { pl } from "./messages/pl";
import { ru } from "./messages/ru";
import { zh } from "./messages/zh";

/** Every language's catalog; English is complete by definition. */
export const CATALOGS: Readonly<Record<Locale, Translation<EnglishMessages>>> =
  { en, es, zh, ru, pl, bn, ko, ht };

export type Messages = Complete<EnglishMessages>;

const cache = new Map<Locale, Messages>();

/**
 * The messages for a language, every gap filled with English. Built once
 * per language per server instance; server-side only, so a page sends the
 * browser the text it renders and no catalog.
 */
export function messagesFor(locale: Locale): Messages {
  let found = cache.get(locale);
  if (!found) {
    found = locale === DEFAULT_LOCALE ? en : withFallback(en, CATALOGS[locale]);
    cache.set(locale, found);
  }
  return found;
}

/** A route's `[lang]` segment as a language: English for anything else. */
export function localeOf(segment: string | undefined): Locale {
  return isLocale(segment) ? segment : DEFAULT_LOCALE;
}
