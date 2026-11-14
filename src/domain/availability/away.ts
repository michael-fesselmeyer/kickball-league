/**
 * Away weeks: the weeks of a season a player says they'll miss, marked
 * ahead of time on their profile. A week runs Monday to Sunday in the
 * league's time zone and is named by its Monday (YYYY-MM-DD), so a game
 * day falls in exactly one week whatever night the league plays.
 *
 * A captain sees, for each game, who is still available that week, and is
 * prompted to ask for subs when the available players can't field a full
 * lineup under the fielding rule (rulebook 2.3; src/domain/rsvp/fielding.ts).
 */
import {
  checkFielding,
  type FieldingCheck,
  type FieldingRules,
  RULEBOOK,
} from "../rsvp/fielding";

const DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const parse = (date: string) => Date.parse(`${date}T12:00:00Z`);
const format = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Whether `value` is a calendar date written YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const ms = parse(value);
  return !Number.isNaN(ms) && format(ms) === value;
}

/** The Monday of the week holding `date` (both YYYY-MM-DD). */
export function weekOf(date: string): string {
  const ms = parse(date);
  // getUTCDay: Sunday is 0, so Sunday belongs to the week before.
  const back = (new Date(ms).getUTCDay() + 6) % 7;
  return format(ms - back * DAY);
}

/** Whether `date` is a Monday, so it can name a week. */
export const isWeek = (date: string): boolean =>
  isIsoDate(date) && weekOf(date) === date;

/** Every week from the one holding `startsOn` to the one holding `endsOn`. */
export function seasonWeeks(startsOn: string, endsOn: string): string[] {
  const last = parse(weekOf(endsOn));
  const weeks: string[] = [];
  for (let ms = parse(weekOf(startsOn)); ms <= last; ms += 7 * DAY)
    weeks.push(format(ms));
  return weeks;
}

/** "Oct 5 – Oct 11": the Monday of a week and the Sunday after it. */
export function weekLabel(week: string): string {
  const day = (ms: number) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(ms);
  const start = parse(week);
  return `${day(start)} – ${day(start + 6 * DAY)}`;
}

export type Member<Id extends string = string> = {
  userId: Id;
  name: string;
  side: "woman" | "man" | null;
};

export type WeekAvailability<Id extends string = string> = {
  week: string;
  available: number;
  /** Players away that week. */
  away: Member<Id>[];
  fielding: FieldingCheck;
  /** Too few available for a full lineup: worth asking for subs. */
  short: boolean;
};

/**
 * Who on a roster is available in a week, and what they can field. A
 * player who hasn't chosen a side is counted as available but outside the
 * fielding groups, as the RSVP check does.
 */
export function availabilityFor<Id extends string>(
  members: readonly Member<Id>[],
  awayWeeks: ReadonlyMap<Id, ReadonlySet<string>>,
  week: string,
  rules: FieldingRules = RULEBOOK,
): WeekAvailability<Id> {
  const isAway = (m: Member<Id>) => awayWeeks.get(m.userId)?.has(week) ?? false;
  const here = members.filter((m) => !isAway(m));
  const fielding = checkFielding(
    {
      women: here.filter((m) => m.side === "woman").length,
      men: here.filter((m) => m.side === "man").length,
      unknown: here.filter((m) => m.side === null).length,
    },
    rules,
  );
  return {
    week,
    available: here.length,
    away: members.filter(isAway),
    fielding,
    short: fielding.level !== "full",
  };
}

/**
 * The weeks, among `weeks` (the team's weeks with a game still to play),
 * that a change to away weeks takes from a full lineup to short. Those are
 * the weeks to tell the captains about.
 */
export function newlyShort<Id extends string>(
  members: readonly Member<Id>[],
  before: ReadonlyMap<Id, ReadonlySet<string>>,
  after: ReadonlyMap<Id, ReadonlySet<string>>,
  weeks: readonly string[],
  rules: FieldingRules = RULEBOOK,
): string[] {
  return weeks.filter(
    (week) =>
      !availabilityFor(members, before, week, rules).short &&
      availabilityFor(members, after, week, rules).short,
  );
}

/**
 * The away weeks to keep after a player saves the form: their choices for
 * this week and later, and what they had for weeks already gone, which the
 * form no longer offers. Only weeks of the season count.
 */
export function nextAwayWeeks(
  saved: readonly string[],
  chosen: readonly string[],
  seasonWeekList: readonly string[],
  thisWeek: string,
): string[] {
  const inSeason = new Set(seasonWeekList);
  const past = saved.filter((w) => w < thisWeek && inSeason.has(w));
  const ahead = chosen.filter(
    (w) => isWeek(w) && w >= thisWeek && inSeason.has(w),
  );
  return [...new Set([...past, ...ahead])].sort();
}
