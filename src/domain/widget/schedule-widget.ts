import {
  hasResult,
  isCalledOff,
  localDay,
  type PublicGame,
} from "@/domain/schedule/public-game";

/**
 * The embeddable schedule widget (docs/information-architecture.md, /embed):
 * which games it shows. Pure, so the choices are tested without a database.
 */

/** How many games a team's widget lists. */
export const TEAM_WIDGET_GAMES = 3;
/** The most games the league's widget lists from its next game day. */
export const LEAGUE_WIDGET_GAMES = 8;

/** A placed game still to be played: not over, no result, not called off. */
function isUpcoming(g: PublicGame, now: Date): boolean {
  return (
    g.startsAt !== null &&
    g.endsAt !== null &&
    g.endsAt > now &&
    !hasResult(g) &&
    !isCalledOff(g)
  );
}

const byKickoff = (x: PublicGame, y: PublicGame) =>
  (x.startsAt as Date).getTime() - (y.startsAt as Date).getTime() ||
  (x.field ?? "").localeCompare(y.field ?? "");

/** The next games still to play, in kickoff order, at most `limit`. */
export function upcomingGames(
  games: readonly PublicGame[],
  now: Date,
  limit: number,
): PublicGame[] {
  return games
    .filter((g) => isUpcoming(g, now))
    .sort(byKickoff)
    .slice(0, limit);
}

/**
 * The league's next game day: every game still to play on the first local
 * date that has one, in kickoff order, at most LEAGUE_WIDGET_GAMES.
 */
export function nextGameDay(
  games: readonly PublicGame[],
  now: Date,
  timeZone: string,
): { day: string; games: PublicGame[] } | null {
  const upcoming = games.filter((g) => isUpcoming(g, now)).sort(byKickoff);
  const first = upcoming[0];
  if (!first) return null;
  const day = localDay(first.startsAt as Date, timeZone);
  return {
    day,
    games: upcoming
      .filter((g) => localDay(g.startsAt as Date, timeZone) === day)
      .slice(0, LEAGUE_WIDGET_GAMES),
  };
}

type SeasonChoice = { status: string };

const PLAYING = new Set(["in_progress", "playoffs"]);

/**
 * The season the league's widget follows, from public seasons newest first:
 * the one being played, else the next one still to finish (its schedule may
 * be out before opening day), else the newest.
 */
export function widgetSeason<S extends SeasonChoice>(
  seasons: readonly S[],
): S | null {
  return (
    seasons.find((s) => PLAYING.has(s.status)) ??
    seasons.findLast((s) => s.status !== "completed") ??
    seasons[0] ??
    null
  );
}

/**
 * The height a snippet's frame starts at, enough for a full list without a
 * scroll bar on a phone. The page inside scrolls if a long field name wraps.
 */
export const WIDGET_HEIGHT = { team: 300, league: 460 } as const;

const escapeAttr = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/**
 * The HTML a site pastes in: one iframe to the static widget page, lazy
 * loaded, with a title for screen readers and no script.
 */
export function widgetSnippet({
  src,
  title,
  height,
}: {
  src: string;
  title: string;
  height: number;
}): string {
  return `<iframe src="${escapeAttr(src)}" title="${escapeAttr(title)}" width="100%" height="${height}" loading="lazy" style="border:0;max-width:420px"></iframe>`;
}
