import {
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
  localizedPath,
} from "./locales";
import { localesOf } from "./pages";

/**
 * How addresses carry a language (ADR 0065). Every page lives under
 * `src/app/[lang]`; the proxy maps an address onto it from the path alone,
 * so public pages stay static: `/faq` is `/en/faq`, `/es/faq` is itself.
 */

/**
 * The first path segments of the site's own pages under `src/app/[lang]`
 * that aren't a league's (those are LEAGUE_PAGE_ROOTS). A test checks this
 * list against the folders there, so a new page can't be missed.
 */
export const SITE_PAGE_ROOTS = [
  "about",
  "account-deleted",
  "app",
  "contact",
  "faq",
  "free-agents",
  "guest",
  "help",
  "news",
  "nyc-kickball-league",
  "offline",
  "operator",
  "parks",
  "paused",
  "private-events",
  "sign-in",
  "style",
  "unsubscribe",
  "widget",
] as const;

export type LocaleSplit = {
  locale: Locale;
  /** The path without its language prefix: "/faq". */
  rest: string;
  /** The address named a language: "/es/faq", or "/en/faq" typed by hand. */
  prefixed: boolean;
};

/**
 * The language an address asks for, and the rest of its path. Only a
 * language's own code counts as a prefix, so a league or page can never be
 * mistaken for one.
 */
export function splitLocale(pathname: string): LocaleSplit {
  const match = /^\/([a-z]{2})(\/.*)?$/.exec(pathname);
  if (match && isLocale(match[1]))
    return { locale: match[1], rest: match[2] ?? "/", prefixed: true };
  return { locale: DEFAULT_LOCALE, rest: pathname, prefixed: false };
}

/**
 * The public address of a path, whichever form it arrives in: as typed
 * (`/es/faq`) or as the route tree serves it (`/es/l/_default/rules`,
 * `/en/faq`). Language prefix and default league segment both go.
 */
export function publicPathOf(pathname: string): string {
  const match = /^\/([a-z]{2})(\/.*)?$/.exec(pathname);
  const rest = match && isLocale(match[1]) ? (match[2] ?? "/") : pathname;
  const inDefault = /^\/l\/_default(\/.*)?$/.exec(rest);
  return inDefault ? (inDefault[1] ?? "/") : rest;
}

/** The same page in another language, for the switcher. */
export function switchLanguagePath(pathname: string, target: Locale): string {
  return localizedPath(target, splitLocale(pathname).rest);
}

/**
 * The `hreflang` alternates of a public page (`path` without a language
 * prefix): one per language the page is translated into, plus
 * `x-default`, the English page. None for a page in English only.
 */
export function languageAlternates(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  const locales = localesOf(path);
  if (locales.length < 2) return out;
  for (const locale of locales) out[locale] = localizedPath(locale, path);
  out["x-default"] = localizedPath(DEFAULT_LOCALE, path);
  return out;
}
