import {
  type ForecastHour,
  hoursDuring,
  isThunder,
  LIKELY_AT,
  type RainRisk,
  WATCH_AT,
  type Window,
} from "./forecast";

/**
 * The rain-out decision for one park on one game day (ADR 0057): the
 * forecast over the game hours, the rain that has already fallen, and any
 * active National Weather Service alert, read into a level and one plain
 * sentence. Pure functions, so the rule is tested without a network. It
 * only recommends; an owner decides, and nothing is ever cancelled on its
 * own.
 */

/** One hour of the grid forecast: expected rainfall and thunder risk. */
export type GridHour = {
  startsAt: Date;
  /** Expected rainfall in the hour, in inches. */
  rainIn: number;
  /** Chance of thunder, 0 to 100, when the forecast office gives one. */
  thunderChance: number | null;
};

/** One observation from a weather station's report. */
export type Observation = {
  at: Date;
  /** Rain since the station's previous hourly report, in millimeters. */
  lastHourMm: number | null;
};

/** Rain a station measured over a stretch of hours before now. */
export type RainFallen = {
  inches: number;
  /** How many of the hours the station reported in. */
  hoursReported: number;
  hours: number;
};

export type ObservedRain = {
  stationId: string;
  stationName: string;
  last24: RainFallen | null;
  last48: RainFallen | null;
};

/** An active NWS alert for the park's point. */
export type WeatherAlert = {
  event: string;
  headline: string | null;
  severity: string;
  endsAt: Date | null;
};

/** Wet field: rain fallen in the last day plus rain due before first pitch. */
export const WET_WATCH_IN = 0.5;
export const WET_LIKELY_IN = 1;
/** A grid chance of thunder at or above this counts as thunder. */
export const THUNDER_AT = 30;
/** Rain amounts below this read as none. */
const TRACE_IN = 0.05;

const HOUR_MS = 3_600_000;
const MM_PER_IN = 25.4;

/** Alerts about weather that stops a game: storms, floods, wind. */
const PLAY_HAZARD =
  /thunderstorm|tornado|flood|wind|lightning|hurricane|tropical/i;

/** How an alert bears on the call: a warning makes rain likely, a watch worth watching. */
export function alertWeight(alert: WeatherAlert): RainRisk {
  if (!PLAY_HAZARD.test(alert.event)) return "low";
  if (/warning/i.test(alert.event)) return "likely";
  if (/watch|advisory|statement/i.test(alert.event)) return "watch";
  return "low";
}

/**
 * Rain a station measured in the `hours` before `now`. Stations send one
 * routine report an hour (at :51 in New York) and extra reports when the
 * weather changes; an extra report counts the rain since the last routine
 * one, so each hour keeps its largest figure rather than adding them up.
 * A report with no rain figure means no rain. Null when the station sent
 * nothing in that stretch.
 */
export function rainFallen(
  observations: readonly Observation[],
  now: Date,
  hours: number,
): RainFallen | null {
  const from = now.getTime() - hours * HOUR_MS;
  const inWindow = observations.filter(
    (o) => o.at.getTime() > from && o.at.getTime() <= now.getTime(),
  );
  if (inWindow.length === 0) return null;
  const minutes = new Map<number, number>();
  for (const o of inWindow) {
    const m = o.at.getUTCMinutes();
    minutes.set(m, (minutes.get(m) ?? 0) + 1);
  }
  const routine = [...minutes].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  // The routine report that closes each observation's hour.
  const byHour = new Map<number, number>();
  for (const o of inWindow) {
    const hour = Math.ceil((o.at.getTime() - routine * 60_000) / HOUR_MS);
    byHour.set(hour, Math.max(byHour.get(hour) ?? 0, o.lastHourMm ?? 0));
  }
  const mm = [...byHour.values()].reduce((a, b) => a + b, 0);
  return {
    inches: mm / MM_PER_IN,
    hoursReported: Math.min(byHour.size, hours),
    hours,
  };
}

/** One game hour as the card shows it. */
export type DecisionHour = {
  startsAt: Date;
  chance: number;
  rainIn: number;
  thunder: boolean;
};

export type Decision = {
  level: RainRisk;
  /** Nothing to go on: no forecast, no gauge, no alerts. */
  blind: boolean;
  /**
   * First pitch is within a day and a half, so the rain already on the
   * ground and the alerts in effect count.
   */
  near: boolean;
  hours: DecisionHour[];
  peakChance: number;
  thunder: boolean;
  /** Rain expected while games are on, in inches. */
  expectedIn: number;
  /** Rain expected from now until first pitch, in inches. */
  beforePitchIn: number;
  /** Rain fallen in the last day plus rain due before first pitch. */
  wetIn: number | null;
  /** What the nearest station measured, when first pitch is near. */
  observed: ObservedRain | null;
  /** The alerts that bear on play, worst first. */
  hazards: WeatherAlert[];
  /** "Likely unplayable: 0.6 in fell in the last 24 hours and …". */
  summary: string;
};

export type DecisionInput = {
  hourly: readonly ForecastHour[] | null;
  grid: readonly GridHour[] | null;
  observed: ObservedRain | null;
  alerts: readonly WeatherAlert[] | null;
  /** The games at this park that day. */
  games: readonly Window[];
  now: Date;
  timeZone: string;
};

const RANK: Record<RainRisk, number> = { low: 0, watch: 1, likely: 2 };
export const worstRisk = (a: RainRisk, b: RainRisk): RainRisk =>
  RANK[b] > RANK[a] ? b : a;

/** "0.6" from 0.62; a trace keeps two places so it never reads as 0.1. */
export const inches = (value: number): string =>
  value >= 0.095 ? value.toFixed(1) : value.toFixed(2);

/** "6 pm", "11 am", "6:30 pm" in the league's time zone. */
export function hourWords(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).formatToParts(instant);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const half = (parts.find((p) => p.type === "dayPeriod")?.value ?? "")
    .toLowerCase()
    .replace(/\./g, "");
  return `${hour}${minute === "00" ? "" : `:${minute}`} ${half}`;
}

/** "6 to 8 pm", or "11 am to 1 pm" when it crosses noon. */
export function spanWords(from: Date, to: Date, timeZone: string): string {
  const start = hourWords(from, timeZone);
  const end = hourWords(to, timeZone);
  const [startClock, startHalf] = start.split(" ");
  const endHalf = end.split(" ")[1];
  return startHalf === endHalf
    ? `${startClock} to ${end}`
    : `${start} to ${end}`;
}

const join = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** The rain-out decision for one park's games on one day. */
export function decide(input: DecisionInput): Decision {
  const { games, now, timeZone } = input;
  const firstPitch = games.reduce<Date | null>(
    (a, g) => (a === null || g.startsAt < a ? g.startsAt : a),
    null,
  );
  const gridByHour = new Map(
    (input.grid ?? []).map((h) => [h.startsAt.getTime(), h]),
  );

  // Every forecast hour any game overlaps, once.
  const gameHours = new Map<number, ForecastHour>();
  for (const g of games)
    for (const h of hoursDuring(input.hourly ?? [], g))
      gameHours.set(h.startsAt.getTime(), h);
  const hours: DecisionHour[] = [...gameHours.values()]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map((h) => {
      const grid = gridByHour.get(h.startsAt.getTime());
      return {
        startsAt: h.startsAt,
        chance: Math.round(h.precipChance),
        rainIn: grid?.rainIn ?? 0,
        thunder:
          isThunder(h.summary) || (grid?.thunderChance ?? 0) >= THUNDER_AT,
      };
    });

  const peakChance = hours.reduce((a, h) => Math.max(a, h.chance), 0);
  const thunder = hours.some((h) => h.thunder);
  const expectedIn = hours.reduce((a, h) => a + h.rainIn, 0);
  // Rain on the ground and alerts in effect say something about today's
  // field, not one a week away.
  const timing = whenIs(firstPitch, now);
  const near = timing === "near";
  const beforePitchIn =
    firstPitch === null || !near
      ? 0
      : (input.grid ?? [])
          .filter(
            (h) =>
              h.startsAt.getTime() + HOUR_MS > now.getTime() &&
              h.startsAt.getTime() < firstPitch.getTime(),
          )
          .reduce((a, h) => a + h.rainIn, 0);
  const observed = near ? input.observed : null;
  const fallen = observed?.last24 ?? null;
  const wetIn =
    !near || (fallen === null && input.grid === null)
      ? null
      : (fallen?.inches ?? 0) + beforePitchIn;
  const hazards = (near ? (input.alerts ?? []) : [])
    .filter((a) => alertWeight(a) !== "low")
    .sort((a, b) => RANK[alertWeight(b)] - RANK[alertWeight(a)]);

  let level: RainRisk = "low";
  if (thunder || peakChance >= LIKELY_AT) level = "likely";
  else if (peakChance >= WATCH_AT) level = "watch";
  if (wetIn !== null) {
    if (wetIn >= WET_LIKELY_IN) level = "likely";
    else if (wetIn >= WET_WATCH_IN) level = worstRisk(level, "watch");
  }
  for (const a of hazards) level = worstRisk(level, alertWeight(a));

  const blind =
    hours.length === 0 && input.observed === null && input.alerts === null;
  const summary =
    timing === "past"
      ? "This game day is over."
      : blind
        ? "No weather to go on yet: the National Weather Service hasn't answered."
        : hours.length === 0 && !near
          ? "Too early to tell: the hourly forecast doesn't reach this game day yet."
          : summarize({
              level,
              hours,
              peakChance,
              thunder,
              expectedIn,
              beforePitchIn,
              observed,
              hazards,
              timeZone,
            });
  return {
    level,
    blind,
    near,
    hours,
    peakChance,
    thunder,
    expectedIn,
    beforePitchIn,
    wetIn,
    observed,
    hazards,
    summary,
  };
}

/**
 * The decision-time alert goes to whoever confirms rain-outs when first
 * pitch is 2 to 8 hours away. Its job runs at fixed hours (vercel.json):
 * about 4 to 5 hours before the league's usual afternoon and evening
 * starts, and this reach catches whichever run comes first.
 */
export const DECISION_FROM_MS = 2 * HOUR_MS;
export const DECISION_UNTIL_MS = 8 * HOUR_MS;

/** Whether a game day starting at `firstPitch` is due its decision alert at `now`. */
export function dueForDecision(firstPitch: Date, now: Date): boolean {
  const ahead = firstPitch.getTime() - now.getTime();
  return ahead >= DECISION_FROM_MS && ahead <= DECISION_UNTIL_MS;
}

/** How far a field's ground and alerts reach: a day and a half ahead. */
export const NEAR_AHEAD_MS = 36 * HOUR_MS;

function whenIs(firstPitch: Date | null, now: Date): "near" | "ahead" | "past" {
  if (firstPitch === null) return "near";
  const ahead = firstPitch.getTime() - now.getTime();
  if (ahead < -12 * HOUR_MS) return "past";
  return ahead <= NEAR_AHEAD_MS ? "near" : "ahead";
}

function summarize(d: {
  level: RainRisk;
  hours: readonly DecisionHour[];
  peakChance: number;
  thunder: boolean;
  expectedIn: number;
  beforePitchIn: number;
  observed: ObservedRain | null;
  hazards: readonly WeatherAlert[];
  timeZone: string;
}): string {
  const reasons: string[] = [];
  const last24 = d.observed?.last24;
  const last48 = d.observed?.last48;
  if (last24 && last24.inches >= TRACE_IN)
    reasons.push(`${inches(last24.inches)} in fell in the last 24 hours`);
  else if (last48 && last48.inches >= TRACE_IN)
    reasons.push(`${inches(last48.inches)} in fell in the last 2 days`);
  if (d.beforePitchIn >= TRACE_IN)
    reasons.push(
      `${inches(d.beforePitchIn)} in more is due before first pitch`,
    );

  if (d.hours.length > 0) {
    const what = d.thunder ? "storms" : "rain";
    const wet = d.hours.filter((h) => h.chance >= WATCH_AT || h.thunder);
    const first = wet[0];
    const last = wet.at(-1);
    reasons.push(
      first && last
        ? `${d.peakChance}% chance of ${what} ${spanWords(
            first.startsAt,
            new Date(last.startsAt.getTime() + HOUR_MS),
            d.timeZone,
          )}`
        : `${d.peakChance}% chance of rain while games are on`,
    );
    if (d.expectedIn >= TRACE_IN)
      reasons.push(`about ${inches(d.expectedIn)} in expected during games`);
  }
  for (const a of d.hazards)
    reasons.push(
      a.endsAt
        ? `a ${a.event} until ${hourWords(a.endsAt, d.timeZone)}`
        : `a ${a.event}`,
    );

  const lead =
    d.level === "likely"
      ? "Likely unplayable"
      : d.level === "watch"
        ? "Worth watching"
        : "Looks playable";
  return reasons.length > 0 ? `${lead}: ${join(reasons)}.` : `${lead}.`;
}
