import { err, ok, type Result } from "../result";
import { slugify } from "../slug";
import { type PermitEndRule, permitEndRule } from "../gameday/permit-end";
import { MAX_NO_NEW_INNING_MINUTES } from "../gameday/game-clock";
import { MAX_DAYLIGHT_MARGIN_MINUTES } from "../gameday/daylight";
import { isBestOf, MAX_BEST_OF } from "@/domain/sports/dodgeball";

/**
 * Divisions and rule sets as an admin enters them (ADR 0040). Pure: the
 * queries in src/db/queries/divisions.ts store what these accept.
 */

export const MAX_DIVISION_NAME = 40;
export const MAX_CROSSOVER_GAMES = 10;

/** A division's name and the slug its public pages use. */
export function parseDivisionName(
  raw: string,
): Result<{ name: string; slug: string }, "invalid_name"> {
  const name = raw.trim().replace(/\s+/g, " ");
  const slug = slugify(name);
  if (!slug || name.length > MAX_DIVISION_NAME) return err("invalid_name");
  return ok({ name, slug });
}

export type RuleSetInput = {
  name: string;
  innings: number | null;
  /** Sets in a match, for a sport played in sets (ADR 0087); set only when given. */
  bestOf?: number;
  timeLimitMinutes: number | null;
  bunting: boolean;
  stealing: boolean;
  /** What happens when a game reaches the end of its permit; the default when left out. */
  permitEndRule?: PermitEndRule;
  /** Minutes before the time limit when no new inning starts; null for the default. */
  noNewInningMinutes?: number | null;
  /** Minutes before sunset that play ends on a field without lights (#467); the default when left out. */
  daylightMarginMinutes?: number;
};

/** A whole number in range, or null when the field was left empty. */
function optionalWhole(
  raw: string,
  min: number,
  max: number,
): number | null | undefined {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

/** A rule set from the admin's form: a name, and optional limits. */
export function parseRuleSet(raw: {
  name: string;
  innings: string;
  /** Sets in a match: odd, 1 to 9; empty or missing for the sport's default. */
  bestOf?: string;
  timeLimitMinutes: string;
  bunting: boolean;
  stealing: boolean;
  /** "last_inning_to_start" or "call_at_last_complete"; anything else is the default. */
  permitEndRule?: string;
  /** Left empty for the default. */
  noNewInningMinutes?: string;
  /** Whole minutes from 0 to 60, or empty for the default. */
  daylightMarginMinutes?: string;
}): Result<RuleSetInput, "invalid_name" | "invalid_limits"> {
  const name = raw.name.trim().replace(/\s+/g, " ");
  if (!slugify(name) || name.length > MAX_DIVISION_NAME)
    return err("invalid_name");
  const innings = optionalWhole(raw.innings, 1, 15);
  const timeLimitMinutes = optionalWhole(raw.timeLimitMinutes, 10, 240);
  const noNewInningMinutes = optionalWhole(
    raw.noNewInningMinutes ?? "",
    0,
    MAX_NO_NEW_INNING_MINUTES,
  );
  const margin = optionalWhole(
    raw.daylightMarginMinutes ?? "",
    0,
    MAX_DAYLIGHT_MARGIN_MINUTES,
  );
  const bestOf = optionalWhole(raw.bestOf ?? "", 1, MAX_BEST_OF);
  if (
    innings === undefined ||
    timeLimitMinutes === undefined ||
    noNewInningMinutes === undefined ||
    margin === undefined ||
    bestOf === undefined ||
    (bestOf !== null && !isBestOf(bestOf))
  )
    return err("invalid_limits");
  return ok({
    name,
    innings,
    ...(bestOf !== null ? { bestOf } : {}),
    timeLimitMinutes,
    bunting: raw.bunting,
    stealing: raw.stealing,
    permitEndRule: permitEndRule({ permitEndRule: raw.permitEndRule }),
    noNewInningMinutes,
    ...(margin === null ? {} : { daylightMarginMinutes: margin }),
  });
}

/** "7 innings · 55 minutes · bunting allowed": a rule set in a line. */
export function ruleSetSummary(rules: {
  innings: number | null;
  bestOf?: number | null;
  timeLimitMinutes: number | null;
  options: {
    bunting?: boolean;
    stealing?: boolean;
    daylightMarginMinutes?: number;
  };
}): string {
  return [
    rules.bestOf == null ? null : `best of ${rules.bestOf} sets`,
    rules.innings === null ? null : `${rules.innings} innings`,
    rules.timeLimitMinutes === null
      ? null
      : `${rules.timeLimitMinutes}-minute limit`,
    rules.options.bunting === undefined
      ? null
      : rules.options.bunting
        ? "bunting allowed"
        : "no bunting",
    rules.options.stealing === undefined
      ? null
      : rules.options.stealing
        ? "stealing allowed"
        : "no stealing",
    rules.options.daylightMarginMinutes === undefined
      ? null
      : `play ends ${rules.options.daylightMarginMinutes} minutes before sunset`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

/** The season's crossover settings from the admin's form. */
export function parseCrossoverGames(
  raw: string,
): Result<number, "invalid_crossovers"> {
  const n = Number(raw.trim() === "" ? "0" : raw);
  return Number.isInteger(n) && n >= 0 && n <= MAX_CROSSOVER_GAMES
    ? ok(n)
    : err("invalid_crossovers");
}

/**
 * Teams by division, in the divisions' order, then the teams with none.
 * A season with no divisions is one group, `null`.
 */
export function groupByDivision<T extends { divisionId: string | null }>(
  divisions: readonly { id: string }[],
  teams: readonly T[],
): { divisionId: string | null; teams: T[] }[] {
  if (divisions.length === 0) return [{ divisionId: null, teams: [...teams] }];
  const known = new Set(divisions.map((d) => d.id));
  const groups = divisions.map((d) => ({
    divisionId: d.id,
    teams: teams.filter((t) => t.divisionId === d.id),
  }));
  const none = teams.filter(
    (t) => t.divisionId === null || !known.has(t.divisionId),
  );
  return none.length > 0
    ? [...groups, { divisionId: null, teams: none }]
    : groups;
}
