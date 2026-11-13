import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { db } from "@/db/client";
import { publicEventSlugs } from "@/db/queries/events";
import { publicSeasons } from "@/db/queries/sitemap";
import { env } from "@/env";
import { buildSitemap, eventPages } from "@/lib/seo/sitemap";
import { siteOrigin } from "@/lib/site";

/**
 * /sitemap.xml: the content pages, each public season's standings, and the
 * events page with every event. Read at request time, so a new season or
 * event shows up without a deploy.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const [seasons, events] = await Promise.all([
    publicSeasons(db),
    publicEventSlugs(db),
  ]);
  return buildSitemap(siteOrigin(env.BETTER_AUTH_URL), [
    ...seasons.map((s) => ({
      path: `/seasons/${s.slug}/standings`,
      lastModified: s.updatedAt,
    })),
    ...eventPages(events),
  ]);
}
