import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { db } from "@/db/client";
import { publicEventSlugs } from "@/db/queries/events";
import { publishedSummarySeasons } from "@/db/queries/owner-dashboard";
import { publicSeasons, publicTeamPages } from "@/db/queries/sitemap";
import { publicSponsorPages } from "@/db/queries/sponsors";
import { env } from "@/env";
import { buildSitemap, eventPages } from "@/lib/seo/sitemap";
import { siteOrigin } from "@/lib/site";

/**
 * /sitemap.xml: the content pages, each public season's standings, schedule
 * and published money summary, every team page, the
 * events page with every event, and each sponsor's page. Read at request
 * time, so a new season, event or sponsor shows up without a deploy.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const [seasons, teams, events, sponsors, summaries] = await Promise.all([
    publicSeasons(db),
    publicTeamPages(db),
    publicEventSlugs(db),
    publicSponsorPages(db),
    publishedSummarySeasons(db),
  ]);
  return buildSitemap(siteOrigin(env.BETTER_AUTH_URL), [
    ...seasons.flatMap((s) => [
      { path: `/seasons/${s.slug}/standings`, lastModified: s.updatedAt },
      { path: `/seasons/${s.slug}/schedule`, lastModified: s.updatedAt },
    ]),
    ...teams.map((t) => ({
      path: `/teams/${t.slug}`,
      lastModified: t.updatedAt,
    })),
    ...summaries.map((s) => ({
      path: `/seasons/${s.slug}/money`,
      lastModified: s.publishedAt,
    })),
    ...eventPages(events),
    ...sponsors.map((s) => ({
      path: `/sponsors/${s.slug}`,
      lastModified: s.updatedAt,
    })),
  ]);
}
