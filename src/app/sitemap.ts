import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { db } from "@/db/client";
import { publicSeasons } from "@/db/queries/sitemap";
import { env } from "@/env";
import { buildSitemap } from "@/lib/seo/sitemap";
import { siteOrigin } from "@/lib/site";

/**
 * /sitemap.xml: the content pages, plus each public season's standings.
 * Read at request time, so a new season shows up without a deploy.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const seasons = await publicSeasons(db);
  return buildSitemap(
    siteOrigin(env.BETTER_AUTH_URL),
    seasons.map((s) => ({
      path: `/seasons/${s.slug}/standings`,
      lastModified: s.updatedAt,
    })),
  );
}
