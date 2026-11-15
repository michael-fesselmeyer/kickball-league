import type { Tiebreaker } from "@/domain/standings/standings";
import {
  bestOfOr,
  checkDodgeballScore,
  DEFAULT_BEST_OF,
  setsToWin,
} from "./dodgeball";
import {
  checkScore,
  MAX_RUNS,
  MIN_CALLED_INNINGS,
  RUN_DIFFERENCE_CAP,
} from "./kickball";
import type { CheckOptions, ScoreErrors, ScoreInput } from "./result";

/**
 * What varies by sport (ADR 0072). A league plays one sport; every screen
 * and query that depends on the rules asks this module instead of assuming
 * kickball. Sports without a module of their own play by kickball's rules,
 * as every league did before sports had rules.
 */

/** Sports with rules of their own. */
export const SPORTS_WITH_RULES = ["kickball", "dodgeball"] as const;
export type RulesKey = (typeof SPORTS_WITH_RULES)[number];

type Words = { one: string; many: string };

export type SportRules = {
  /** Whose rules these are. */
  key: RulesKey;
  score: {
    /** The unit a team scores in: "run" / "runs" / "R". */
    unit: Words & { letter: string };
    /** Periods a called game counts, or null when the sport has none. */
    period: Words | null;
    /** Sets in a match by default, for a sport played in sets; else null. */
    defaultBestOf: number | null;
    /** The most one side can score in a game of this length. */
    max: (bestOf: number | null) => number;
    /** The most a game moves the standings' difference; null for no cap. */
    differenceCap: number | null;
    /** Whether the live, period-by-period scoring screen exists for it. */
    liveScoring: boolean;
    /** The rule for a game called early, as the score form says it. */
    calledRule: (bestOf: number | null) => string;
    check: (input: ScoreInput, options?: CheckOptions) => ScoreErrors;
  };
  /** Where it is played; outdoors means weather, daylight and permits matter. */
  place: Words & { outdoors: boolean };
  /** Whether the season's gender rule for who is in play applies. */
  genderRule: boolean;
  /** How the standings name each tiebreaker: "run difference". */
  tiebreakers: Record<Tiebreaker, string>;
};

const KICKBALL: SportRules = {
  key: "kickball",
  score: {
    unit: { one: "run", many: "runs", letter: "R" },
    period: { one: "inning", many: "innings" },
    defaultBestOf: null,
    max: () => MAX_RUNS,
    differenceCap: RUN_DIFFERENCE_CAP,
    liveScoring: true,
    calledRule: () =>
      `A called game counts after ${MIN_CALLED_INNINGS} complete innings, with the score at the last complete inning.`,
    check: checkScore,
  },
  place: { one: "field", many: "fields", outdoors: true },
  genderRule: true,
  tiebreakers: {
    win_pct: "",
    head_to_head: "head-to-head",
    run_difference: "run difference",
    runs_allowed: "runs allowed",
    coin_flip: "coin flip",
  },
};

const DODGEBALL: SportRules = {
  key: "dodgeball",
  score: {
    unit: { one: "set", many: "sets", letter: "S" },
    period: null,
    defaultBestOf: DEFAULT_BEST_OF,
    max: (bestOf) => setsToWin(bestOfOr(bestOf)),
    // Sets are bounded by the match length, so there's nothing to cap.
    differenceCap: null,
    liveScoring: false,
    calledRule: (bestOf) =>
      `A match called early, before either team wins ${setsToWin(bestOfOr(bestOf))} sets, counts with the sets as they stand.`,
    check: checkDodgeballScore,
  },
  place: { one: "court", many: "courts", outdoors: false },
  genderRule: false,
  tiebreakers: {
    win_pct: "",
    head_to_head: "head-to-head",
    run_difference: "set difference",
    runs_allowed: "sets allowed",
    coin_flip: "coin flip",
  },
};

const RULES: Record<RulesKey, SportRules> = {
  kickball: KICKBALL,
  dodgeball: DODGEBALL,
};

/** Whether a sport has rules of its own rather than kickball's. */
export const hasOwnRules = (sport: string): sport is RulesKey =>
  (SPORTS_WITH_RULES as readonly string[]).includes(sport);

/** The rules a league of `sport` plays by: its own, else kickball's. */
export const sportRules = (sport: string | null | undefined): SportRules =>
  sport && hasOwnRules(sport) ? RULES[sport] : KICKBALL;

/** "1 run", "3 sets". */
export const scoreUnits = (rules: SportRules, n: number) =>
  `${n} ${n === 1 ? rules.score.unit.one : rules.score.unit.many}`;

/**
 * What the score form needs to know about the sport, as plain data a
 * client component can take: the unit, the most a side can score, and the
 * called-game rule with its periods, if the sport counts them.
 */
export type ScoreFormRules = {
  unit: string;
  max: number;
  period: string | null;
  minPeriods: number;
  calledRule: string;
};

export function scoreFormRules(
  rules: SportRules,
  bestOf: number | null,
): ScoreFormRules {
  return {
    unit: rules.score.unit.many,
    max: rules.score.max(bestOf),
    period: rules.score.period?.many ?? null,
    minPeriods: rules.score.period ? MIN_CALLED_INNINGS : 0,
    calledRule: rules.score.calledRule(bestOf),
  };
}

/** The score form's rules for kickball, the default. */
export const KICKBALL_FORM: ScoreFormRules = scoreFormRules(KICKBALL, null);

/** " (called after 5 innings)", or " (called early)" without periods. */
export const calledNote = (inningsPlayed: number | null) =>
  inningsPlayed === null
    ? " (called early)"
    : ` (called after ${inningsPlayed} innings)`;
