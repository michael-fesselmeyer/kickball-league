import { err, ok, type Result } from "../result";
import { localDate } from "../scheduler/slots";
import { slugify } from "../slug";
import { localTime, zonedInstant } from "../time/zoned";

/**
 * Season rollover: a new draft season started from an existing one in one
 * action. Pure: the query loads the source season and this works out what
 * the new one gets, so the preview and the copy are the same plan.
 *
 * Copied: the settings (prices, early bird, roster limits, games per day,
 * fielding rules, tiebreakers, rebate policy, divisions' crossover
 * settings, the waiver version), the divisions with their rule sets, the
 * teams that played with their captains and co-captains, and the permit
 * windows' fields and hours. Every date moves by the same number of days,
 * keeping its wall-clock time in the league's time zone, so an 8 pm game
 * day stays 8 pm across a daylight-saving change.
 *
 * Starts fresh: payments, waiver signatures, registrations of everyone
 * else, RSVPs, games, scores, schedules, lineups, suspensions, sub
 * requests, conflicts, promo codes, photos and giveaways. Captains get a
 * new registration that still needs their waiver and payment. A permit
 * window comes back as requested, without its number, cost or document,
 * because the new permit has to be applied for.
 */

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isDate = (value: string) =>
  DATE.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

/** `date` (YYYY-MM-DD) moved by `days`. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS,
  );
}

/**
 * An instant moved by `days`, keeping its wall-clock time in `timeZone`:
 * 8 pm on a summer Monday is still 8 pm on the Monday it lands on in
 * winter, an hour later in UTC.
 */
export function shiftInstant(
  instant: Date,
  days: number,
  timeZone: string,
): Date {
  return zonedInstant(
    addDays(localDate(instant, timeZone), days),
    localTime(instant, timeZone),
    timeZone,
  );
}

/**
 * Where the next season starts unless the admin picks another day: the
 * first day after the source season ends that falls on the same weekday
 * as its first day, so game days keep their weekday.
 */
export function suggestedStart(startsOn: string, endsOn: string): string {
  const weekday = new Date(`${startsOn}T12:00:00Z`).getUTCDay();
  const after = addDays(endsOn, 1);
  const offset = (weekday - new Date(`${after}T12:00:00Z`).getUTCDay() + 7) % 7;
  return addDays(after, offset);
}

/** "Fall 2026" → "Fall 2027" when the season moves a year; else "… (next)". */
export function suggestedName(name: string, days: number): string {
  const years = Math.round(days / 365);
  const match = /\b(20\d\d)\b/.exec(name);
  if (match && years > 0)
    return name.replace(match[1] ?? "", String(Number(match[1]) + years));
  return `${name} (next)`;
}

export type SourceSeason = {
  name: string;
  startsOn: string;
  endsOn: string;
  feeModel: "per_team" | "per_player";
  teamFeeCents: number | null;
  playerFeeCents: number | null;
  freeAgentFeeCents: number | null;
  earlyBirdEndsAt: Date | null;
  earlyBirdDiscountCents: number | null;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  paymentDeadlineAt: Date | null;
  maxTeams: number | null;
  rosterMin: number;
  rosterMax: number;
  gamesPerTeamPerDay: number;
};

export type SourceDivision = { id: string; name: string };

export type SourceTeam = {
  teamSeasonId: string;
  teamId: string;
  name: string;
  status: string;
  divisionId: string | null;
  captains: readonly {
    userId: string;
    name: string;
    role: "captain" | "co_captain";
  }[];
};

export type SourceWindow = {
  id: string;
  fieldId: string;
  fieldName: string;
  startsAt: Date;
  endsAt: Date;
  status: "requested" | "confirmed" | "lost";
};

/** Teams that played the season: not on the waitlist, not withdrawn. */
export const playedTheSeason = (team: { status: string }) =>
  team.status !== "waitlisted" && team.status !== "withdrawn";

export type RolloverChoice = {
  name: string;
  startsOn: string;
  /** Team-season ids to bring along. */
  teamIds: ReadonlySet<string>;
};

export type RolloverPlan = {
  days: number;
  name: string;
  slug: string;
  dates: {
    startsOn: string;
    endsOn: string;
    registrationOpensAt: Date | null;
    registrationClosesAt: Date | null;
    paymentDeadlineAt: Date | null;
    earlyBirdEndsAt: Date | null;
  };
  teams: SourceTeam[];
  /** Captains and co-captains brought along, across every team. */
  captainCount: number;
  windows: (SourceWindow & { newStartsAt: Date; newEndsAt: Date })[];
};

export type RolloverProblem = "name" | "date" | "same_dates";

export function planRollover(
  source: SourceSeason,
  teams: readonly SourceTeam[],
  windows: readonly SourceWindow[],
  choice: RolloverChoice,
  timeZone: string,
): Result<RolloverPlan, RolloverProblem> {
  const name = choice.name.trim();
  const slug = slugify(name);
  if (!name || name.length > 60 || !slug) return err("name");
  if (!isDate(choice.startsOn)) return err("date");
  const days = daysBetween(source.startsOn, choice.startsOn);
  if (days === 0) return err("same_dates");
  const shift = (instant: Date | null) =>
    instant === null ? null : shiftInstant(instant, days, timeZone);
  const kept = teams.filter((t) => choice.teamIds.has(t.teamSeasonId));
  return ok({
    days,
    name,
    slug,
    dates: {
      startsOn: choice.startsOn,
      endsOn: addDays(source.endsOn, days),
      registrationOpensAt: shift(source.registrationOpensAt),
      registrationClosesAt: shift(source.registrationClosesAt),
      paymentDeadlineAt: shift(source.paymentDeadlineAt),
      earlyBirdEndsAt: shift(source.earlyBirdEndsAt),
    },
    teams: kept,
    captainCount: kept.reduce((n, t) => n + t.captains.length, 0),
    // A lost permit is not asked for again.
    windows: windows
      .filter((w) => w.status !== "lost")
      .map((w) => ({
        ...w,
        newStartsAt: shiftInstant(w.startsAt, days, timeZone),
        newEndsAt: shiftInstant(w.endsAt, days, timeZone),
      })),
  });
}
