import type { MetadataRoute } from "next";
import { absoluteUrl } from "../site";

/**
 * The sitemap and robots rules (docs/seo-plan.md, section 3). Kept apart from
 * the route files so they can be tested without a server or a database.
 */

/** Content pages that exist on every deployment, most important first. */
export const CONTENT_PAGES = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/parks/mccarren-park", changeFrequency: "monthly", priority: 0.8 },
  { path: "/faq", changeFrequency: "monthly", priority: 0.7 },
  { path: "/about", changeFrequency: "monthly", priority: 0.6 },
  { path: "/records", changeFrequency: "weekly", priority: 0.5 },
] as const satisfies readonly {
  path: string;
  changeFrequency: "weekly" | "monthly";
  priority: number;
}[];

/** A public page backed by data, with the time it last changed. */
export type DataPage = { path: string; lastModified: Date };

export function buildSitemap(
  origin: string,
  dataPages: readonly DataPage[] = [],
): MetadataRoute.Sitemap {
  return [
    ...CONTENT_PAGES.map((page) => ({
      url: absoluteUrl(origin, page.path),
      changeFrequency: page.changeFrequency,
      priority: page.priority,
    })),
    ...dataPages.map((page) => ({
      url: absoluteUrl(origin, page.path),
      lastModified: page.lastModified,
      changeFrequency: "daily" as const,
      priority: 0.5,
    })),
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
