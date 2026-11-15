import {
  type Bracket,
  type BracketFormat,
  isTitleGame,
  type MatchStage,
  roundName,
  seedOrder,
  sourceCode,
} from "@/domain/scheduler/bracket";

export { roundName };
export type { BracketFormat, MatchStage };

/**
 * Playoffs (roadmap section 4, milestone 1; scheduling-algorithm.md,
 * section 8): seeds from the final standings, a single-elimination bracket,
 * and winners moving on as playoff scores become final.
 *
 * Pure: no clock, no database. The scheduler's placeBracket lays the
 * bracket onto slots; this module seeds it and keeps it moving.
 */

/**
 * Where one side of a match comes from: a seed, or the winner or the loser
 * of an earlier match.
 */
export type MatchSource =
  { seed: number } | { winnerOf: string } | { loserOf: string };

/** One bracket match as it stands. */
export type MatchState = {
  /** As placeBracket names it: `r2m1`, `l3m2`, `gf`, `gf2`, `p3`. */
  code: string;
  stage: MatchStage;
  round: number;
  /** 1-based place in its round; a bye leaves a gap. */
  position: number;
  /** The game's number in the bracket, in the order games are played. */
  gameNo: number;
  sourceA: MatchSource;
  sourceB: MatchSource;
  teamA: string | null;
  teamB: string | null;
  winner: string | null;
  /** The "if necessary" final, once it is not needed. */
  skipped: boolean;
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
    const source = (side: (typeof m)["home"]): MatchSource =>
      "seed" in side
        ? { seed: side.seed }
        : "winnerOf" in side
          ? { winnerOf: side.winnerOf }
          : { loserOf: side.loserOf };
    const team = (side: (typeof m)["home"]) =>
      "seed" in side ? side.teamId : null;
    return {
      code: m.id,
      stage: m.stage,
      round: m.round,
      position: m.position,
      gameNo: m.gameNo,
      sourceA: source(m.home),
      sourceB: source(m.away),
      teamA: team(m.home),
      teamB: team(m.away),
      winner: null,
      skipped: false,
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

/** Where a match's winner (or loser) goes next, and on which side. */
export function nextMatch(
  matches: readonly MatchState[],
  code: string,
  who: "winner" | "loser" = "winner",
): { code: string; side: "A" | "B" } | null {
  const fed = (source: MatchSource) =>
    who === "winner"
      ? "winnerOf" in source && source.winnerOf === code
      : "loserOf" in source && source.loserOf === code;
  for (const m of matches) {
    if (fed(m.sourceA)) return { code: m.code, side: "A" };
    if (fed(m.sourceB)) return { code: m.code, side: "B" };
  }
  return null;
}

/** One side of a later match that a result filled, changed or emptied. */
export type Move = {
  code: string;
  side: "A" | "B";
  from: string | null;
  to: string | null;
};

export type Advance = {
  matches: MatchState[];
  /** Sides of later matches that changed: the winner's, the loser's. */
  moves: Move[];
  /** True when the "if necessary" final is now not needed, or needed again. */
  skipped: { code: string; skipped: boolean } | null;
  /** The bracket's champion after this result, if it is decided. */
  champion: string | null;
};

/**
 * Records a match's winner and moves the winner on, and the loser too
 * where the bracket has a place for them (the losers' side, the
 * third-place game). A grand final won by the winners' side champion ends
 * the bracket, so its "if necessary" game is skipped; won by the losers'
 * side champion, both teams have one loss and play it. A corrected result
 * replaces the teams it had moved on; a result that is no longer a win
 * (null) takes them back out. Matches further on are left to the caller,
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
  const loser =
    winner === null
      ? null
      : winner === current.teamA
        ? current.teamB
        : current.teamA;
  // A grand final the winners' side champion took needs no second game.
  const ends =
    current.stage === "grand_final" &&
    winner !== null &&
    winner === current.teamA;
  const targets = new Map<string, { side: "A" | "B"; to: string | null }[]>();
  for (const [who, team] of [
    ["winner", winner],
    ["loser", loser],
  ] as const) {
    const next = nextMatch(matches, code, who);
    if (!next) continue;
    const to = ends ? null : team;
    targets.set(next.code, [
      ...(targets.get(next.code) ?? []),
      { side: next.side, to },
    ]);
  }
  const moves: Move[] = [];
  let skipped: Advance["skipped"] = null;
  const updated = matches.map((m) => {
    if (m.code === code) return { ...m, winner };
    const sides = targets.get(m.code);
    if (!sides) return m;
    let changed = { ...m };
    for (const { side, to } of sides) {
      const from = side === "A" ? m.teamA : m.teamB;
      if (from === to) continue;
      moves.push({ code: m.code, side, from, to });
      changed =
        side === "A" ? { ...changed, teamA: to } : { ...changed, teamB: to };
    }
    if (m.stage === "reset" && m.skipped !== ends) {
      skipped = { code: m.code, skipped: ends };
      changed = { ...changed, skipped: ends };
    }
    return changed;
  });
  return { matches: updated, moves, skipped, champion: championOf(updated) };
}

/** Matches that can be played: both teams known, and still needed. */
export function isReady(m: MatchState): boolean {
  return m.teamA !== null && m.teamB !== null && !m.skipped;
}

/**
 * The champion once the title is decided: the winner of the
 * single-elimination final, or of the grand final when the winners' side
 * champion takes it, or of the "if necessary" game.
 */
export function championOf(
  matches: readonly Pick<
    MatchState,
    "code" | "stage" | "teamA" | "winner" | "skipped" | "sourceA" | "sourceB"
  >[],
): string | null {
  const reset = matches.find((m) => m.stage === "reset");
  const grand = matches.find((m) => m.stage === "grand_final");
  if (grand) {
    if (grand.winner !== null && grand.winner === grand.teamA)
      return grand.winner;
    return reset && !reset.skipped ? reset.winner : null;
  }
  // The single-elimination final: the main match nothing waits on.
  const fed = new Set(
    matches.flatMap((m) =>
      [m.sourceA, m.sourceB].flatMap((s) =>
        "winnerOf" in s ? [s.winnerOf] : [],
      ),
    ),
  );
  const final = matches.find((m) => m.stage === "main" && !fed.has(m.code));
  return final?.winner ?? null;
}

/** One place in a round on the bracket board: a match, or a first-round bye. */
export type BoardCell<M> =
  { kind: "match"; match: M } | { kind: "bye"; seed: number };

/**
 * The bracket board's columns for the main side: every round with each of
 * its places in order, so lines between rounds meet. A first-round place
 * with no match is the bye of the better seed that would have played there.
 */
export function boardColumns<
  M extends { stage?: MatchStage; round: number; position: number },
>(
  teams: number,
  matches: readonly M[],
): { round: number; cells: BoardCell<M>[] }[] {
  const rounds = roundCount(teams);
  const order = seedOrder(bracketSize(teams));
  const main = matches.filter((m) => (m.stage ?? "main") === "main");
  return Array.from({ length: rounds }, (_, i) => {
    const round = i + 1;
    const places = bracketSize(teams) / 2 ** round;
    const cells = Array.from({ length: places }, (_, p): BoardCell<M> => {
      const match = main.find((m) => m.round === round && m.position === p + 1);
      if (match) return { kind: "match", match };
      return { kind: "bye", seed: order[2 * p] as number };
    });
    return { round, cells };
  });
}

/** The losers' side by round, each round's games in order. */
export function losersColumns<
  M extends { stage: MatchStage; round: number; position: number },
>(matches: readonly M[]): { round: number; matches: M[] }[] {
  const losers = matches.filter((m) => m.stage === "losers");
  const rounds = [...new Set(losers.map((m) => m.round))].sort((a, b) => a - b);
  return rounds.map((round) => ({
    round,
    matches: losers
      .filter((m) => m.round === round)
      .sort((a, b) => a.position - b.position),
  }));
}

/**
 * Game numbers by match code: the stored ones, or, for a bracket made
 * before games were numbered, round by round in bracket order.
 */
export function gameNumbers(
  matches: readonly {
    code: string;
    round: number;
    position: number;
    gameNo: number | null;
  }[],
): Map<string, number> {
  if (matches.every((m) => m.gameNo !== null))
    return new Map(matches.map((m) => [m.code, m.gameNo as number]));
  const ordered = [...matches].sort(
    (a, b) => a.round - b.round || a.position - b.position,
  );
  return new Map(ordered.map((m, i) => [m.code, i + 1]));
}

/** "Seed 3", "Winner of game 5", "Loser of game 2": a side not decided yet. */
export function sourceLabel(
  source: MatchSource,
  gameNo: ReadonlyMap<string, number>,
): string {
  if ("seed" in source) return `Seed ${source.seed}`;
  const code = sourceCode(source) as string;
  const game = gameNo.get(code);
  const which = game === undefined ? "an earlier game" : `game ${game}`;
  return "winnerOf" in source ? `Winner of ${which}` : `Loser of ${which}`;
}

/** Whether a match decides the title, so plays the final's innings. */
export function decidesTitle(
  m: { stage: MatchStage; round: number },
  teams: number,
  format: BracketFormat,
): boolean {
  return isTitleGame(m, roundCount(teams), format);
}

/** Most brackets a season's standings can be split into. */
export const MAX_TIERS = 3;

/**
 * Splits seeds taken in standings order into consecutive tiers: the first
 * `sizes[0]` teams, then the next `sizes[1]`, and so on. Null when a tier
 * has fewer than two teams, there are too many tiers, or not enough teams.
 */
export function splitTiers(
  seeds: readonly string[],
  sizes: readonly number[],
): string[][] | null {
  if (sizes.length === 0 || sizes.length > MAX_TIERS) return null;
  if (
    sizes.some(
      (n) =>
        !Number.isInteger(n) || n < MIN_PLAYOFF_TEAMS || n > MAX_PLAYOFF_TEAMS,
    )
  )
    return null;
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total > seeds.length) return null;
  let from = 0;
  return sizes.map((n) => {
    const tier = seeds.slice(from, from + n);
    from += n;
    return tier;
  });
}

/** "Championship", "Second tier", "Third tier". */
export function tierName(tier: number): string {
  return tier === 1
    ? "Championship"
    : tier === 2
      ? "Second tier"
      : `Tier ${tier}`;
}

/**
 * A bracket's seeds when two divisions each send `n` teams and their
 * champions meet in a combined final (ADR 0040). The first division's
 * teams fill the top half of the bracket and the second's the bottom, each
 * in its own standard order (1 v n, 2 v n−1, ...), so no division meets the
 * other before the final. Returns the teams in bracket-seed order, ready
 * for placeBracket, or null unless both send the same number of teams.
 */
export function divisionHalvesSeeds(
  first: readonly string[],
  second: readonly string[],
): string[] | null {
  const n = first.length;
  if (n === 0 || second.length !== n) return null;
  const size = bracketSize(2 * n);
  const order = seedOrder(size);
  const half = (from: number) =>
    order.slice(from, from + size / 2).sort((a, b) => a - b);
  const seeds: string[] = [];
  for (const [teams, slots] of [
    [first, half(0)],
    [second, half(size / 2)],
  ] as const)
    teams.forEach((team, i) => {
      seeds[(slots[i] as number) - 1] = team;
    });
  return seeds;
}
