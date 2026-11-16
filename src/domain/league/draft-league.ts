import { sportRules } from "@/domain/sports/sports";
import { slugify } from "../slug";
import {
  isReservedLeagueSlug,
  type NewLeagueInput,
  type Sport,
  sportLabel,
} from "./new-league";
import { isLeagueSlug } from "./paths";

/**
 * A new league opened from an interest sign-up option (ADR 0087): one step
 * from "this option has enough interest" to a league with a draft season,
 * filled in from the option and the league that asked. Everything here is
 * a starting point the league's admins change before registration opens;
 * the draft season is not public. Pure: the caller passes today's date and
 * the addresses already taken.
 */

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** What the interest option named; any part may be missing. */
export type InterestChoice = {
  night: Weekday | null;
  format: "social" | "competitive" | null;
  park: string | null;
};

/** What the new league copies from the league that ran the sign-ups. */
export type SourceLeague = {
  timeZone: string;
  minimumAge: number;
  primaryColor: string;
  secondaryColor: string;
};

/** Fees and roster limits to start from: the source league's latest season. */
export type SeasonTemplate = {
  feeModel: "per_team" | "per_player";
  teamFeeCents: number | null;
  playerFeeCents: number | null;
  freeAgentFeeCents: number | null;
  rosterMin: number;
  rosterMax: number;
};

export type DraftSeason = SeasonTemplate & {
  name: string;
  slug: string;
  status: "draft";
  startsOn: string;
  endsOn: string;
  maxTeams: number;
};

/** Weeks from today to the first game, time to book a field and sign up. */
export const LEAD_WEEKS = 6;
/** Game days in the draft season. */
export const DRAFT_GAME_DAYS = 8;
const MAX_NAME = 80;
const MAX_SLUG = 40;
const capitalize = (s: string) => `${s[0]?.toUpperCase() ?? ""}${s.slice(1)}`;

/** "Thursday Social Kickball at McCarren Park". */
export function draftLeagueName(choice: InterestChoice, sport: Sport): string {
  const name = [
    choice.night ? capitalize(choice.night) : null,
    choice.format ? capitalize(choice.format) : null,
    sportLabel(sport),
  ]
    .filter((part) => part !== null)
    .join(" ");
  const full = choice.park ? `${name} at ${choice.park}` : name;
  return full.length <= MAX_NAME ? full : full.slice(0, MAX_NAME).trimEnd();
}

/** An address for the name that no league has yet: "thursday-kickball-2". */
export function freeSlug(name: string, taken: ReadonlySet<string>): string {
  const base =
    slugify(name).slice(0, MAX_SLUG).replace(/-+$/, "") || "new-league";
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const slug = `${base.slice(0, MAX_SLUG - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (isLeagueSlug(slug) && !isReservedLeagueSlug(slug) && !taken.has(slug))
      return slug;
  }
}

const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * The first game day: the option's night, at least LEAD_WEEKS from today;
 * without a night, LEAD_WEEKS from today.
 */
export function firstGameDay(today: string, night: Weekday | null): string {
  const earliest = addDays(today, LEAD_WEEKS * 7);
  if (!night) return earliest;
  const day = new Date(`${earliest}T12:00:00Z`).getUTCDay();
  return addDays(earliest, (WEEKDAYS.indexOf(night) - day + 7) % 7);
}

export function draftLeague(input: {
  choice: InterestChoice;
  sport: Sport;
  source: SourceLeague;
  template: SeasonTemplate | null;
  teamsNeeded: number;
  playersPerTeam: number;
  takenSlugs: ReadonlySet<string>;
  today: string;
}): { league: NewLeagueInput; season: DraftSeason } {
  const name = draftLeagueName(input.choice, input.sport);
  const bestOf = sportRules(input.sport).score.defaultBestOf;
  const startsOn = firstGameDay(input.today, input.choice.night);
  return {
    league: {
      name,
      slug: freeSlug(name, input.takenSlugs),
      sport: input.sport,
      timeZone: input.source.timeZone,
      minimumAge: input.source.minimumAge,
      primaryColor: input.source.primaryColor,
      secondaryColor: input.source.secondaryColor,
      ruleSet: {
        name: "Standard",
        innings: null,
        ...(bestOf !== null ? { bestOf } : {}),
        timeLimitMinutes: null,
      },
    },
    season: {
      name: "First season",
      slug: "first-season",
      status: "draft",
      startsOn,
      endsOn: addDays(startsOn, (DRAFT_GAME_DAYS - 1) * 7),
      maxTeams: input.teamsNeeded,
      ...(input.template ?? {
        feeModel: "per_player",
        teamFeeCents: null,
        playerFeeCents: 0,
        freeAgentFeeCents: null,
        rosterMin: Math.min(10, input.playersPerTeam),
        rosterMax: Math.max(20, input.playersPerTeam),
      }),
    },
  };
}
