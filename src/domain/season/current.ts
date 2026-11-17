/**
 * The season the site's header means by "Schedule" and "Standings": the one
 * being played (or in its playoffs), else the latest finished one, else the
 * newest public season (one that hasn't started yet). Seasons come newest
 * first, as the /seasons page lists them.
 */
export type SeasonSummary = { slug: string; status: string };

const PLAYING = new Set(["in_progress", "playoffs"]);

export function currentSeason<T extends SeasonSummary>(
  newestFirst: readonly T[],
): T | null {
  return (
    newestFirst.find((s) => PLAYING.has(s.status)) ??
    newestFirst.find((s) => s.status === "completed") ??
    newestFirst[0] ??
    null
  );
}

/** The views the header's links open in the current season. */
export const CURRENT_SEASON_VIEWS = [
  "schedule",
  "standings",
  "bracket",
] as const;
export type CurrentSeasonView = (typeof CURRENT_SEASON_VIEWS)[number];

export const isCurrentSeasonView = (v: string): v is CurrentSeasonView =>
  (CURRENT_SEASON_VIEWS as readonly string[]).includes(v);
