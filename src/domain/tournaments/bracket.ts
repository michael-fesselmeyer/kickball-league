import { err, ok, type Result } from "@/domain/result";
import {
  advance,
  championOf,
  isReady,
  type MatchState,
  matchesFrom,
} from "@/domain/playoffs/playoffs";
import { placeBracket } from "@/domain/scheduler/bracket";

/**
 * A tournament's bracket (ADR 0064): the playoff format's single
 * elimination, seeded from the guest teams instead of a season's standings.
 * Pure. Team ids are guest_team ids; names are copied in so the bracket and
 * its results outlive the guest data that is deleted after the event.
 */

export const MIN_BRACKET_TEAMS = 2;
export const MAX_BRACKET_TEAMS = 32;

export type TournamentSeed = { seed: number; teamId: string; name: string };

export type TournamentMatch = MatchState & {
  scoreA: number | null;
  scoreB: number | null;
  /** Free text such as "Field 2", set by an admin. */
  place: string | null;
  /** When it is played, as an ISO instant; null until an admin sets it. */
  startsAt: string | null;
};

export type TournamentBracket = {
  seeds: TournamentSeed[];
  matches: TournamentMatch[];
  champion: string | null;
};

export type BracketError =
  | "too_few"
  | "too_many"
  | "no_such_match"
  | "not_ready"
  | "tie"
  | "bad_score"
  | "later_played";

export const BRACKET_ERRORS: Readonly<Record<BracketError, string>> = {
  too_few: `A bracket needs at least ${MIN_BRACKET_TEAMS} teams.`,
  too_many: `A bracket holds at most ${MAX_BRACKET_TEAMS} teams.`,
  no_such_match: "That game is not in the bracket.",
  not_ready: "Both teams must be known before a score can be entered.",
  tie: "A bracket game cannot end in a tie. Enter the score after extra innings.",
  bad_score: "Scores are whole numbers from 0 to 99.",
  later_played:
    "The winner already played the next round. Fix that score first.",
};

/**
 * Seeds the teams in the order given (sign-up order, or a shuffled order)
 * and lays out the rounds. A field that is not a power of two gives the top
 * seeds byes.
 */
export function makeBracket(
  teams: readonly { id: string; name: string }[],
): Result<TournamentBracket, BracketError> {
  if (teams.length < MIN_BRACKET_TEAMS) return err("too_few");
  if (teams.length > MAX_BRACKET_TEAMS) return err("too_many");
  const seeds = teams.map((t, i) => ({
    seed: i + 1,
    teamId: t.id,
    name: t.name,
  }));
  const laid = placeBracket(
    seeds.map((s) => s.teamId),
    [],
  );
  const matches = matchesFrom(laid).map((m) => ({
    ...m,
    scoreA: null,
    scoreB: null,
    place: null,
    startsAt: null,
  }));
  return ok({ seeds, matches, champion: null });
}

const validScore = (n: number) => Number.isInteger(n) && n >= 0 && n <= 99;

/**
 * Records a game's score and moves the winner on. A corrected score moves
 * the new winner on in the old winner's place, unless the next game has
 * already been played, which has to be fixed first.
 */
export function recordScore(
  bracket: TournamentBracket,
  code: string,
  scoreA: number,
  scoreB: number,
): Result<TournamentBracket, BracketError> {
  const match = bracket.matches.find((m) => m.code === code);
  if (!match) return err("no_such_match");
  if (!isReady(match) || match.teamA === null || match.teamB === null)
    return err("not_ready");
  if (!validScore(scoreA) || !validScore(scoreB)) return err("bad_score");
  if (scoreA === scoreB) return err("tie");
  const winner = scoreA > scoreB ? match.teamA : match.teamB;
  if (nextPlayed(bracket, code) && match.winner !== winner)
    return err("later_played");
  // `advance` spreads each match, so scores and places ride along.
  const moved = advance(bracket.matches, code, winner)
    .matches as TournamentMatch[];
  const matches = moved.map((m) =>
    m.code === code ? { ...m, scoreA, scoreB } : m,
  );
  return ok({ ...bracket, matches, champion: championOf(matches) });
}

/** Whether the match this one feeds has a winner already. */
function nextPlayed(bracket: TournamentBracket, code: string): boolean {
  return bracket.matches.some(
    (m) =>
      m.winner !== null &&
      (("winnerOf" in m.sourceA && m.sourceA.winnerOf === code) ||
        ("winnerOf" in m.sourceB && m.sourceB.winnerOf === code)),
  );
}

/** Whether any game has a result, which locks the seeding. */
export function hasResults(bracket: TournamentBracket): boolean {
  return bracket.matches.some((m) => m.winner !== null);
}

/** The teams in the bracket, for "is this team in it". */
export function teamsIn(bracket: TournamentBracket): Set<string> {
  return new Set(bracket.seeds.map((s) => s.teamId));
}

/** A team's name in the bracket, or null for a bye or an unknown team. */
export function nameOf(
  bracket: TournamentBracket,
  teamId: string | null,
): string | null {
  return bracket.seeds.find((s) => s.teamId === teamId)?.name ?? null;
}

/**
 * Sets where (a field, as free text) and when a game is played. An empty
 * place or a null time clears it.
 */
export function setSchedule(
  bracket: TournamentBracket,
  code: string,
  place: string,
  startsAt: Date | null,
): Result<TournamentBracket, BracketError> {
  if (!bracket.matches.some((m) => m.code === code))
    return err("no_such_match");
  const clean = place.replace(/\s+/g, " ").trim().slice(0, 60);
  return ok({
    ...bracket,
    matches: bracket.matches.map((m) =>
      m.code === code
        ? {
            ...m,
            place: clean || null,
            startsAt: startsAt?.toISOString() ?? null,
          }
        : m,
    ),
  });
}
