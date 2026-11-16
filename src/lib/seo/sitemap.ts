import type { MetadataRoute } from "next";
import { type Locale, localizedPath } from "@/i18n/locales";
import { localesOf } from "@/i18n/pages";
import { absoluteUrl } from "../site";

/**
 * The sitemap and robots rules (docs/seo-plan.md, section 3). Kept apart from
 * the route files so they can be tested without a server or a database.
 */

/** Content pages that exist on every deployment, most important first. */
export const CONTENT_PAGES = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/parks/mccarren-park", changeFrequency: "monthly", priority: 0.8 },
  { path: "/seasons", changeFrequency: "weekly", priority: 0.8 },
  { path: "/faq", changeFrequency: "monthly", priority: 0.7 },
  { path: "/rules", changeFrequency: "weekly", priority: 0.6 },
  { path: "/contact", changeFrequency: "monthly", priority: 0.4 },
  { path: "/nyc-kickball-league", changeFrequency: "monthly", priority: 0.7 },
  { path: "/free-agents", changeFrequency: "monthly", priority: 0.7 },
  {
    path: "/news/how-to-play-kickball",
    changeFrequency: "monthly",
    priority: 0.6,
  },
  { path: "/about", changeFrequency: "monthly", priority: 0.6 },
  { path: "/events", changeFrequency: "weekly", priority: 0.6 },
  { path: "/sponsors", changeFrequency: "weekly", priority: 0.5 },
  { path: "/private-events", changeFrequency: "monthly", priority: 0.5 },
  { path: "/friends", changeFrequency: "monthly", priority: 0.4 },
  { path: "/records", changeFrequency: "weekly", priority: 0.5 },
  { path: "/history", changeFrequency: "weekly", priority: 0.5 },
  { path: "/help", changeFrequency: "monthly", priority: 0.5 },
  { path: "/help/player", changeFrequency: "monthly", priority: 0.4 },
  { path: "/help/captain", changeFrequency: "monthly", priority: 0.4 },
  { path: "/help/ref", changeFrequency: "monthly", priority: 0.3 },
  { path: "/help/admin", changeFrequency: "monthly", priority: 0.3 },
  { path: "/help/owner", changeFrequency: "monthly", priority: 0.3 },
  { path: "/widget", changeFrequency: "monthly", priority: 0.3 },
] as const satisfies readonly {
  path: string;
  changeFrequency: "weekly" | "monthly";
  priority: number;
}[];

/** A public page backed by data, with the time it last changed. */
export type DataPage = { path: string; lastModified: Date };

type Entry = MetadataRoute.Sitemap[number];

/**
 * A page's entries: one per language it is translated into (ADR 0094),
 * each listing the others as `hreflang` alternates. English only: one
 * entry, as before.
 */
function inEachLanguage(
  origin: string,
  path: string,
  entry: Omit<Entry, "url">,
  localesFor: (path: string) => Locale[],
): Entry[] {
  const locales = localesFor(path);
  const url = (locale: Locale) =>
    absoluteUrl(origin, localizedPath(locale, path));
  const alternates =
    locales.length > 1
      ? {
          alternates: {
            languages: Object.fromEntries(locales.map((l) => [l, url(l)])),
          },
        }
      : {};
  return locales.map((locale) => ({
    ...entry,
    url: url(locale),
    ...alternates,
  }));
}

export function buildSitemap(
  origin: string,
  dataPages: readonly DataPage[] = [],
  localesFor: (path: string) => Locale[] = localesOf,
): MetadataRoute.Sitemap {
  return [
    ...CONTENT_PAGES.flatMap((page) =>
      inEachLanguage(
        origin,
        page.path,
        { changeFrequency: page.changeFrequency, priority: page.priority },
        localesFor,
      ),
    ),
    ...dataPages.flatMap((page) =>
      inEachLanguage(
        origin,
        page.path,
        {
          lastModified: page.lastModified,
          changeFrequency: "daily" as const,
          priority: 0.5,
        },
        localesFor,
      ),
    ),
  ];
}

/** Signed-in screens, API routes and the internal style guide stay out of search. */
export const PRIVATE_PATHS = ["/app", "/api", "/style", "/sign-in"] as const;

export function buildRobots(
  origin: string,
  indexable: boolean,
): MetadataRoute.Robots {
  if (!indexable) {
    // Previews and local builds: nothing here should be indexed.
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: { userAgent: "*", allow: "/", disallow: [...PRIVATE_PATHS] },
    sitemap: absoluteUrl(origin, "/sitemap.xml"),
  };
}

/** Each event's page (the events page itself is a content page). */
export function eventPages(
  events: readonly { slug: string; updatedAt: Date }[],
): DataPage[] {
  return events.map((e) => ({
    path: `/events/${e.slug}`,
    lastModified: e.updatedAt,
  }));
}
