import { type Bracket, roundName, seedOrder } from "@/domain/scheduler/bracket";

export { roundName };

/**
 * Playoffs (roadmap section 4, milestone 1; scheduling-algorithm.md,
 * section 8): seeds from the final standings, a single-elimination bracket,
 * and winners moving on as playoff scores become final.
 *
 * Pure: no clock, no database. The scheduler's placeBracket lays the
 * bracket onto slots; this module seeds it and keeps it moving.
 */

/** Where one side of a match comes from: a seed, or the winner of a match. */
export type MatchSource = { seed: number } | { winnerOf: string };

/** One bracket match as it stands. */
export type MatchState = {
  /** `r{round}m{position}`, as placeBracket names it. */
  code: string;
  round: number;
  /** 1-based place in its round; a first-round bye leaves a gap. */
  position: number;
  sourceA: MatchSource;
  sourceB: MatchSource;
  teamA: string | null;
  teamB: string | null;
  winner: string | null;
};

/** "Top 8, or all teams if fewer" (open-questions.md, question 6). */
export const DEFAULT_PLAYOFF_TEAMS = 8;
export const MIN_PLAYOFF_TEAMS = 2;
export const MAX_PLAYOFF_TEAMS = 32;

/** How many teams qualify by default when `available` teams could. */
export function defaultPlayoffTeams(available: number): number {
  return Math.min(DEFAULT_PLAYOFF_TEAMS, available);
}

/**
 * Seeds in standings order: the first `count` eligible teams by rank. The
 * standings already broke ties with the season's tiebreakers, so rank order
 * is final. Teams that left the season are skipped, not counted.
 */
export function pickSeeds(
  rows: readonly { teamId: string; rank: number }[],
  eligible: ReadonlySet<string>,
  count: number,
): string[] {
  return [...rows]
    .sort((a, b) => a.rank - b.rank)
    .filter((r) => eligible.has(r.teamId))
    .slice(0, Math.max(0, count))
    .map((r) => r.teamId);
}

/** The smallest power of two that holds `teams`. */
export function bracketSize(teams: number): number {
  let size = 2;
  while (size < teams) size *= 2;
  return size;
}

/** Number of rounds in a bracket for `teams` teams. */
export function roundCount(teams: number): number {
  return teams < 2 ? 0 : Math.log2(bracketSize(teams));
}

/** Seeds that skip the first round because the field is not a power of two. */
export function byeSeeds(teams: number): number[] {
  if (teams < 2) return [];
  const order = seedOrder(bracketSize(teams));
  const byes: number[] = [];
  for (let i = 0; i < order.length; i += 2) {
    const [home, away] = [order[i] as number, order[i + 1] as number];
    if (away > teams) byes.push(home);
  }
  return byes.sort((a, b) => a - b);
}

/** Turns placeBracket's output into match states with the seeded teams in. */
export function matchesFrom(bracket: Bracket): MatchState[] {
  return bracket.matches.map((m) => {
    const position = Number(m.id.slice(m.id.indexOf("m") + 1));
    const source = (side: (typeof m)["home"]): MatchSource =>
      "seed" in side ? { seed: side.seed } : { winnerOf: side.winnerOf };
    const team = (side: (typeof m)["home"]) =>
      "seed" in side ? side.teamId : null;
    return {
      code: m.id,
      round: m.round,
      position,
      sourceA: source(m.home),
      sourceB: source(m.away),
      teamA: team(m.home),
      teamB: team(m.away),
      winner: null,
    };
  });
}

/** A finished game's result, as the game row holds it. */
export type GameResult = {
  status: string;
  teamA: string;
  teamB: string;
  scoreA: number | null;
  scoreB: number | null;
  forfeitBy: string | null;
};

/**
 * Who won a finished game: the higher score, or the team that did not
 * forfeit. Null while the game is not finished, and for a tie, which a
 * playoff game cannot end in (rulebook 3.1.2).
 */
export function gameWinner(g: GameResult): string | null {
  if (g.status === "forfeit" && g.forfeitBy)
    return g.forfeitBy === g.teamA ? g.teamB : g.teamA;
  if (g.status !== "final" || g.scoreA === null || g.scoreB === null)
    return null;
  if (g.scoreA === g.scoreB) return null;
  return g.scoreA > g.scoreB ? g.teamA : g.teamB;
}

/** The match a match's winner moves on to, and on which side. */
export function nextMatch(
  matches: readonly MatchState[],
  code: string,
): { code: string; side: "A" | "B" } | null {
  for (const m of matches) {
    if ("winnerOf" in m.sourceA && m.sourceA.winnerOf === code)
      return { code: m.code, side: "A" };
    if ("winnerOf" in m.sourceB && m.sourceB.winnerOf === code)
      return { code: m.code, side: "B" };
  }
  return null;
}

export type Advance = {
  matches: MatchState[];
  /** The side that changed in the next match, if one did. */
  moved: {
    code: string;
    side: "A" | "B";
    from: string | null;
    to: string | null;
  } | null;
  /** True when this result decided the final. */
  champion: string | null;
};

/**
 * Records a match's winner and moves them into the next match. A corrected
 * result replaces the team it had moved on; a result that is no longer a
 * win (null) takes it back out. Matches further on are left to the caller,
 * which knows whether they have been played.
 */
export function advance(
  matches: readonly MatchState[],
  code: string,
  winner: string | null,
): Advance {
  const current = matches.find((m) => m.code === code);
  if (!current) throw new Error(`Unknown bracket match ${code}.`);
  if (winner !== null && winner !== current.teamA && winner !== current.teamB)
    throw new Error(`Team ${winner} does not play in match ${code}.`);
  const next = nextMatch(matches, code);
  let moved: Advance["moved"] = null;
  const updated = matches.map((m) => {
    if (m.code === code) return { ...m, winner };
    if (next && m.code === next.code) {
      const from = next.side === "A" ? m.teamA : m.teamB;
      if (from === winner) return m;
      moved = { code: m.code, side: next.side, from, to: winner };
      return next.side === "A"
        ? { ...m, teamA: winner }
        : { ...m, teamB: winner };
    }
    return m;
  });
  return { matches: updated, moved, champion: next ? null : winner };
}

/** Matches that can be played: both teams known. */
export function isReady(m: MatchState): boolean {
  return m.teamA !== null && m.teamB !== null;
}

/** The champion once the final has a winner. */
export function championOf(matches: readonly MatchState[]): string | null {
  const last = Math.max(0, ...matches.map((m) => m.round));
  const final = matches.find((m) => m.round === last);
  return final?.winner ?? null;
}

/** One place in a round on the bracket board: a match, or a first-round bye. */
export type BoardCell<M> =
  { kind: "match"; match: M } | { kind: "bye"; seed: number };

/**
 * The bracket board's columns: every round with each of its places in
 * order, so lines between rounds meet. A first-round place with no match is
 * the bye of the better seed that would have played there.
 */
export function boardColumns<M extends { round: number; position: number }>(
  teams: number,
  matches: readonly M[],
): { round: number; cells: BoardCell<M>[] }[] {
  const rounds = roundCount(teams);
  const order = seedOrder(bracketSize(teams));
  return Array.from({ length: rounds }, (_, i) => {
    const round = i + 1;
    const places = bracketSize(teams) / 2 ** round;
    const cells = Array.from({ length: places }, (_, p): BoardCell<M> => {
      const match = matches.find(
        (m) => m.round === round && m.position === p + 1,
      );
      if (match) return { kind: "match", match };
      return { kind: "bye", seed: order[2 * p] as number };
    });
    return { round, cells };
  });
}

/** "Winner of semifinal 2", for a side not decided yet. */
export function sourceLabel(source: MatchSource, rounds: number): string {
  if ("seed" in source) return `Seed ${source.seed}`;
  const [round, position] = source.winnerOf.slice(1).split("m").map(Number) as [
    number,
    number,
  ];
  const name = roundName(round, rounds);
  const game =
    name === "Semifinals"
      ? "semifinal"
      : name === "Quarterfinals"
        ? "quarterfinal"
        : `round ${round} game`;
  return `Winner of ${game} ${position}`;
}
