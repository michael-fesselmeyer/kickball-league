import { desc, ne } from "drizzle-orm";
import { season } from "../schema/season";
import type { Db } from "./schedule";

/** Seasons with public pages: every season except drafts, newest first. */
export async function publicSeasons(db: Db) {
  return db
    .select({ slug: season.slug, updatedAt: season.updatedAt })
    .from(season)
    .where(ne(season.status, "draft"))
    .orderBy(desc(season.startsOn));
}
