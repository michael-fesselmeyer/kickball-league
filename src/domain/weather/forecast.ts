/**
 * Reading a forecast for kickball (docs/architecture.md, section 7): what a
 * game page shows for one game, and how risky a whole game day looks. Pure
 * functions over hourly forecast periods, so the rules are tested without a
 * network.
 */

/** One hour of a forecast, in the units the league shows. */
export type ForecastHour = {
  startsAt: Date;
  endsAt: Date;
  temperatureF: number;
  /** Chance of precipitation, 0 to 100. */
  precipChance: number;
  /** The forecaster's words: "Chance Showers And Thunderstorms". */
  summary: string;
};

export type RainRisk = "low" | "watch" | "likely";

/** Any game hour at or above this chance makes rain likely. */
export const LIKELY_AT = 70;
/** Any game hour at or above this chance puts the day on watch. */
export const WATCH_AT = 40;

export const isThunder = (summary: string): boolean => /thunder/i.test(summary);

export type Window = { startsAt: Date; endsAt: Date };

/** The forecast hours that overlap a window, in order. */
export function hoursDuring(
  hours: readonly ForecastHour[],
  window: Window,
): ForecastHour[] {
  return hours
    .filter(
      (h) =>
        h.startsAt.getTime() < window.endsAt.getTime() &&
        h.endsAt.getTime() > window.startsAt.getTime(),
    )
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export type GameForecast = {
  /** At kickoff. */
  temperatureF: number;
  /** The highest chance of rain while the game is on. */
  precipChance: number;
  /** The forecaster's words for the wettest hour of the game. */
  summary: string;
  thunder: boolean;
};

/**
 * What the game page shows for one game, or null when the forecast does not
 * reach the game's start (too far ahead, or already past).
 */
export function gameForecast(
  hours: readonly ForecastHour[],
  game: Window,
): GameForecast | null {
  const during = hoursDuring(hours, game);
  const kickoff = during[0];
  if (!kickoff || kickoff.startsAt.getTime() > game.startsAt.getTime())
    return null;
  const wettest = during.reduce((a, b) =>
    b.precipChance > a.precipChance ? b : a,
  );
  return {
    temperatureF: Math.round(kickoff.temperatureF),
    precipChance: Math.round(wettest.precipChance),
    summary: wettest.summary,
    thunder: during.some((h) => isThunder(h.summary)),
  };
}

export type DayRisk = {
  level: RainRisk;
  /** The highest chance of rain in any game hour. */
  peakChance: number;
  thunder: boolean;
  /** How many of the windows the forecast covered; 0 means it said nothing. */
  covered: number;
};

/**
 * The risk rule for a game day, over the hours games are scheduled. Likely:
 * any game hour at 70% or more, or thunderstorms. Watch: any game hour at
 * 40 to 69%. Low otherwise. It only recommends; an admin decides.
 */
export function rainRisk(
  hours: readonly ForecastHour[],
  windows: readonly Window[],
): DayRisk {
  let peakChance = 0;
  let thunder = false;
  let covered = 0;
  for (const w of windows) {
    const during = hoursDuring(hours, w);
    if (during.length > 0) covered++;
    for (const h of during) {
      peakChance = Math.max(peakChance, Math.round(h.precipChance));
      thunder ||= isThunder(h.summary);
    }
  }
  const level: RainRisk =
    thunder || peakChance >= LIKELY_AT
      ? "likely"
      : peakChance >= WATCH_AT
        ? "watch"
        : "low";
  return { level, peakChance, thunder, covered };
}

/**
 * How far ahead of a game day's first pitch the rain alert looks. The job
 * runs once a day in the evening, so a 30-hour reach catches the next day's
 * games about 24 hours ahead whatever time they start.
 */
export const ALERT_AHEAD_MS = 30 * 3_600_000;

/** Whether a game day starting at `firstPitch` is due a rain check at `now`. */
export function dueForRainCheck(firstPitch: Date, now: Date): boolean {
  const ahead = firstPitch.getTime() - now.getTime();
  return ahead > 0 && ahead <= ALERT_AHEAD_MS;
}
