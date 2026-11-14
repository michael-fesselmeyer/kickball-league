import { cookies } from "next/headers";
import { cache } from "react";
import { db } from "@/db/client";
import {
  defaultLeague,
  type LeagueInfo,
  leagueBySlug,
} from "@/db/queries/leagues";
import type { LeagueId } from "@/domain/ids";
import { isLeagueSlug, leagueHref } from "@/domain/league/paths";

/**
 * The cookie that remembers which league the app is showing (ADR 0048). The
 * signed-in app is dynamic, so it may read it; public pages never do: they
 * take their league from the path.
 */
export const LEAGUE_COOKIE = "league";

/** A year: the league stays chosen until the person switches. */
export const LEAGUE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The league the app shows: the one the person last switched to, if it
 * still exists, otherwise the default league. Null only before any league
 * exists. Once per render, like the session.
 */
export const activeLeague = cache(async (): Promise<LeagueInfo | null> => {
  const chosen = (await cookies()).get(LEAGUE_COOKIE)?.value;
  if (chosen && isLeagueSlug(chosen)) {
    const found = await leagueBySlug(db, chosen);
    if (found) return found;
  }
  return defaultLeague(db);
});

/** The id of the league the app is showing, for queries scoped by league. */
export async function activeLeagueId(): Promise<LeagueId | null> {
  return (await activeLeague())?.id ?? null;
}

/**
 * A public page's address in the league the app is showing (ADR 0048), for
 * links and share text built in the app.
 */
export async function activeLeaguePath(path: string): Promise<string> {
  const league = await activeLeague();
  return league ? leagueHref(league, path) : path;
}
