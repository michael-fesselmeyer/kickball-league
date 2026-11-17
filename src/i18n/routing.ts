import {
  DEFAULT_LOCALE,
  isLocale,
  LANG_ATTRIBUTES,
  type Locale,
  localizedPath,
} from "./locales";
import { isTranslated, localesOf } from "./pages";

/**
 * How addresses carry a language (ADR 0094). Every page lives under
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

/**
 * A link from a page in `locale` to `path`: the same language where the
 * target is translated, else the English page.
 */
export function linkIn(locale: Locale, path: string): string {
  return isTranslated(locale, path.split(/[?#]/)[0] ?? path)
    ? localizedPath(locale, path)
    : path;
}

/** The same page in another language, for the switcher. */
export function switchLanguagePath(pathname: string, target: Locale): string {
  return localizedPath(target, splitLocale(pathname).rest);
}

/**
 * Where the footer's link to `target` goes (src/app/language): the page the
 * visitor came from, in that language, when it is translated; else that
 * language's home page, or the English one. Signed-in pages follow the
 * profile's setting, so their link goes there.
 *
 * The page comes from the link's own `from` (the path the footer's script
 * adds on click), else the `Referer`. Either is trusted only from this site,
 * only its path and query are used, and only a page counts: a file such as
 * `/sw.js`, `/_next/...` or `/api/...` goes to the home page instead.
 */
export function languageSwitchTarget(
  source: { from: string | null; referer: string | null },
  origin: string,
  target: Locale,
): string {
  const local =
    sameSitePath(source.from, origin, true) ??
    sameSitePath(source.referer, origin, false);
  const page = local && isPagePath(local.pathname) ? local : null;
  const path = page ? splitLocale(page.pathname).rest : "/";
  if (path === "/app" || path.startsWith("/app/")) return PROFILE_LANGUAGE;
  if (isTranslated(target, path))
    return `${localizedPath(target, path)}${page?.search ?? ""}`;
  return isTranslated(target, "/") ? localizedPath(target, "/") : "/";
}

/**
 * `value` as an address on this site, or null. A `from` must be a path
 * (`/es/faq?x=1`), never a full or protocol-relative address; a `Referer`
 * is a full address on `origin`.
 */
function sameSitePath(
  value: string | null,
  origin: string,
  pathOnly: boolean,
): URL | null {
  if (!value) return null;
  if (pathOnly && !/^\/(?![/\\])/.test(value)) return null;
  try {
    const url = pathOnly ? new URL(value, origin) : new URL(value);
    return url.origin === origin ? url : null;
  } catch {
    return null;
  }
}

/**
 * Whether `pathname` can be a page a visitor reads: not a file with an
 * extension, the client's build files, an API route, or the language
 * switch itself.
 */
export function isPagePath(pathname: string): boolean {
  if (/^\/(?:_next|api|language)(?:\/|$)/.test(pathname)) return false;
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return !last.includes(".");
}

/** The profile's language setting, where signed-in pages pick a language. */
export const PROFILE_LANGUAGE = "/app/profile#language";

/**
 * The `hreflang` alternates of a public page (`path` without a language
 * prefix): one per language the page is translated into, plus
 * `x-default`, the English page. None for a page in English only.
 */
export function languageAlternates(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  const locales = localesOf(path);
  if (locales.length < 2) return out;
  for (const locale of locales)
    out[LANG_ATTRIBUTES[locale]] = localizedPath(locale, path);
  out["x-default"] = localizedPath(DEFAULT_LOCALE, path);
  return out;
}
