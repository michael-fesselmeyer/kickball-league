import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { db } from "@/db/client";
import { publicEventSlugs } from "@/db/queries/events";
import { allLeagues } from "@/db/queries/leagues";
import { publishedSummarySeasons } from "@/db/queries/owner-dashboard";
import { publicSeasons, publicTeamPages } from "@/db/queries/sitemap";
import { publicSponsorPages } from "@/db/queries/sponsors";
import { publishedAwardSeasons } from "@/db/queries/stat-awards";
import { leagueHref } from "@/domain/league/paths";
import { env } from "@/env";
import { buildSitemap, type DataPage, eventPages } from "@/lib/seo/sitemap";
import { siteOrigin } from "@/lib/site";

/** A league other than the default lists its own home and section pages. */
const LEAGUE_SECTIONS = ["/", "/events", "/sponsors", "/history", "/records"];

/**
 * /sitemap.xml: the content pages, and for every league (ADR 0048) each
 * public season's standings, schedule, published money summary and
 * published awards, every team page, every event and each sponsor's page.
 * Read at request time, so a new league, season, event or sponsor shows up
 * without a deploy.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const leagues = await allLeagues(db);
  const pages = await Promise.all(
    leagues.map(async (league): Promise<DataPage[]> => {
      const [seasons, teams, events, sponsors, summaries, awards] =
        await Promise.all([
          publicSeasons(db, league.id),
          publicTeamPages(db, league.id),
          publicEventSlugs(db, league.id),
          publicSponsorPages(db, league.id),
          publishedSummarySeasons(db, league.id),
          publishedAwardSeasons(db, league.id),
        ]);
      const sections = league.isDefault
        ? []
        : LEAGUE_SECTIONS.map((path) => ({
            path,
            lastModified: seasons[0]?.updatedAt ?? new Date(0),
          }));
      return [
        ...sections,
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
        ...awards.map((s) => ({
          path: `/seasons/${s.slug}/awards`,
          lastModified: s.publishedAt,
        })),
        ...eventPages(events),
        ...sponsors.map((s) => ({
          path: `/sponsors/${s.slug}`,
          lastModified: s.updatedAt,
        })),
      ].map((page) => ({ ...page, path: leagueHref(league, page.path) }));
    }),
  );
  return buildSitemap(siteOrigin(env.BETTER_AUTH_URL), pages.flat());
}
