import { db } from "@/db/client";
import { publicSeasons } from "@/db/queries/sitemap";

/**
 * A slug no season can have (slugs are lowercase words joined by hyphens),
 * so its page renders as not found. With Cache Components a dynamic route
 * must list at least one param at build time.
 */
export const NO_SEASON = "_";

/**
 * The public seasons to prerender at build time, so the first visit to
 * their schedule and standings is served as static HTML instead of waiting
 * on the database (docs/architecture.md, section 3).
 *
 * A build with no database to read (the CI build job) lists only the
 * placeholder; those pages are then rendered on their first visit and cached.
 */
export async function publicSeasonParams(): Promise<{ season: string }[]> {
  try {
    const seasons = await publicSeasons(db);
    if (seasons.length > 0) return seasons.map((s) => ({ season: s.slug }));
  } catch (error) {
    console.warn(
      `[build] No seasons prerendered: the database could not be read (${
        error instanceof Error ? error.message : String(error)
      }).`,
    );
  }
  return [{ season: NO_SEASON }];
}
