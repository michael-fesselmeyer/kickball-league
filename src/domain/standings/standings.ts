import { createHash } from "node:crypto";

/**
 * League standings (product-spec.md, "Game day"; open question 6).
 *
 * - Win percentage counts a tie as half a win.
 * - Tied teams are separated by the season's tiebreakers, in order. Each one
 *   is computed over the teams still tied, so head-to-head looks only at
 *   games between them.
 * - Run difference is capped at 10 a game, so a blowout cannot decide a tie.
 * - A forfeit is a win for one team and a loss for the other. Its score does
 *   not count toward runs (an assumption until the owners say otherwise).
 * - The coin flip is a hash of the season and the team, so it is random but
 *   the same every time the table is drawn.
 *
 * Pure: no clock, no database.
 */

export type Tiebreaker =
  "win_pct" | "head_to_head" | "run_difference" | "runs_allowed" | "coin_flip";

export const DEFAULT_TIEBREAKERS: readonly Tiebreaker[] = [
  "win_pct",
  "head_to_head",
  "run_difference",
  "runs_allowed",
  "coin_flip",
];

export const RUN_DIFFERENCE_CAP = 10;

export type ResultGame =
  | {
      kind: "played";
      teamA: string;
      teamB: string;
      scoreA: number;
      scoreB: number;
    }
  | { kind: "forfeit"; teamA: string; teamB: string; forfeitBy: string };

export type StandingsRow = {
  teamId: string;
  rank: number;
  played: number;
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  runsFor: number;
  runsAgainst: number;
  /** Capped at RUN_DIFFERENCE_CAP a game. */
  runDifference: number;
  /** Latest result first: "W3" is three wins in a row; empty before any game. */
  streak: string;
  /** Results of the last five games, oldest first: "WLTWW". */
  lastFive: string;
  /** The tiebreaker that put this team below the one above it, if any. */
  separatedBy: Tiebreaker | null;
};

type Outcome = "W" | "L" | "T";

type Totals = Omit<StandingsRow, "rank" | "separatedBy">;

const winPct = (w: number, t: number, played: number) =>
  played === 0 ? 0 : (w + t / 2) / played;

type Side = {
  team: string;
  outcome: Outcome;
  for: number;
  against: number;
  diff: number;
};

/** The outcome of one game for each side, with the runs that count. */
function sides(game: ResultGame): [Side, Side] {
  if (game.kind === "forfeit") {
    const aLoses = game.forfeitBy === game.teamA;
    return [
      {
        team: game.teamA,
        outcome: aLoses ? "L" : "W",
        for: 0,
        against: 0,
        diff: 0,
      },
      {
        team: game.teamB,
        outcome: aLoses ? "W" : "L",
        for: 0,
        against: 0,
        diff: 0,
      },
    ];
  }
  const outcomeA: Outcome =
    game.scoreA > game.scoreB ? "W" : game.scoreA < game.scoreB ? "L" : "T";
  const outcomeB: Outcome =
    outcomeA === "W" ? "L" : outcomeA === "L" ? "W" : "T";
  const cap = (n: number) =>
    Math.max(-RUN_DIFFERENCE_CAP, Math.min(RUN_DIFFERENCE_CAP, n));
  return [
    {
      team: game.teamA,
      outcome: outcomeA,
      for: game.scoreA,
      against: game.scoreB,
      diff: cap(game.scoreA - game.scoreB),
    },
    {
      team: game.teamB,
      outcome: outcomeB,
      for: game.scoreB,
      against: game.scoreA,
      diff: cap(game.scoreB - game.scoreA),
    },
  ];
}

type Tally = Totals & { outcomes: Outcome[] };

/** A team's tally; every team asked about was passed in, so a miss is a bug. */
function tallyOf(all: Map<string, Tally>, team: string): Tally {
  const tally = all.get(team);
  if (!tally) throw new Error(`No standings row for team ${team}`);
  return tally;
}

function totals(
  teamIds: readonly string[],
  games: readonly ResultGame[],
): Map<string, Tally> {
  const byTeam = new Map<string, Tally>(
    teamIds.map((teamId) => [
      teamId,
      {
        teamId,
        played: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        winPct: 0,
        runsFor: 0,
        runsAgainst: 0,
        runDifference: 0,
        streak: "",
        lastFive: "",
        outcomes: [],
      },
    ]),
  );
  for (const game of games)
    for (const side of sides(game)) {
      const t = byTeam.get(side.team);
      if (!t) continue;
      t.played++;
      if (side.outcome === "W") t.wins++;
      else if (side.outcome === "L") t.losses++;
      else t.ties++;
      t.runsFor += side.for;
      t.runsAgainst += side.against;
      t.runDifference += side.diff;
      t.outcomes.push(side.outcome);
    }
  for (const t of byTeam.values()) {
    t.winPct = winPct(t.wins, t.ties, t.played);
    t.lastFive = t.outcomes.slice(-5).join("");
    const last = t.outcomes.at(-1);
    if (last) {
      let n = 0;
      for (let i = t.outcomes.length - 1; t.outcomes[i] === last; i--) n++;
      t.streak = `${last}${n}`;
    }
  }
  return byTeam;
}

/** Win percentage in the games among `group` only. */
function headToHead(group: readonly string[], games: readonly ResultGame[]) {
  const members = new Set(group);
  const among = games.filter(
    (g) => members.has(g.teamA) && members.has(g.teamB),
  );
  const mini = totals(group, among);
  return (team: string) => mini.get(team)?.winPct ?? 0;
}

function coinFlip(seed: string, team: string): number {
  return parseInt(
    createHash("sha256").update(`${seed}:${team}`).digest("hex").slice(0, 12),
    16,
  );
}

/** A sort key per team for one tiebreaker; higher ranks first. */
function keyFor(
  tiebreaker: Tiebreaker,
  group: readonly string[],
  all: Map<string, Tally>,
  games: readonly ResultGame[],
  seed: string,
): (team: string) => number {
  const of = (team: string) => tallyOf(all, team);
  switch (tiebreaker) {
    case "win_pct":
      return (team) => of(team).winPct;
    case "head_to_head":
      return headToHead(group, games);
    case "run_difference":
      return (team) => of(team).runDifference;
    case "runs_allowed":
      return (team) => -of(team).runsAgainst;
    case "coin_flip":
      return (team) => coinFlip(seed, team);
  }
}

/**
 * Orders `group` by the tiebreakers from `index` on. Returns the teams in
 * order, each with the tiebreaker that separated it from the team above.
 */
function order(
  group: readonly string[],
  tiebreakers: readonly Tiebreaker[],
  index: number,
  all: Map<string, Tally>,
  games: readonly ResultGame[],
  seed: string,
): { team: string; separatedBy: Tiebreaker | null }[] {
  const tiebreaker = tiebreakers[index];
  // Alone, or level after every tiebreaker: alphabetical, sharing a rank.
  if (group.length <= 1 || tiebreaker === undefined)
    return [...group]
      .sort((a, b) => a.localeCompare(b))
      .map((team) => ({ team, separatedBy: null }));
  const key = keyFor(tiebreaker, group, all, games, seed);
  const levels = [...Map.groupBy(group, key)].sort(([a], [b]) => b - a);
  const result: { team: string; separatedBy: Tiebreaker | null }[] = [];
  for (const [, tied] of levels) {
    const inner = order(tied, tiebreakers, index + 1, all, games, seed);
    // The first team of each level was separated from the level above by
    // this tiebreaker; the rest by whatever split them inside the level.
    if (result.length > 0 && inner[0]) inner[0].separatedBy = tiebreaker;
    result.push(...inner);
  }
  return result;
}

/**
 * The standings for `teamIds` from finished games, in rank order. Teams that
 * stay level through every tiebreaker share a rank; with the coin flip last
 * that never happens.
 */
export function standings(
  teamIds: readonly string[],
  games: readonly ResultGame[],
  {
    tiebreakers = DEFAULT_TIEBREAKERS,
    seed,
  }: { tiebreakers?: readonly Tiebreaker[]; seed: string },
): StandingsRow[] {
  const all = totals(teamIds, games);
  // Win percentage always leads; the rest follow the season's order.
  const rules: Tiebreaker[] = [
    "win_pct",
    ...tiebreakers.filter((t) => t !== "win_pct"),
  ];
  const ordered = order(teamIds, rules, 0, all, games, seed);
  let rank = 0;
  return ordered.map(({ team, separatedBy }, i) => {
    if (i === 0 || separatedBy !== null) rank = i + 1;
    const t = tallyOf(all, team);
    return {
      teamId: t.teamId,
      rank,
      played: t.played,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      winPct: t.winPct,
      runsFor: t.runsFor,
      runsAgainst: t.runsAgainst,
      runDifference: t.runDifference,
      streak: t.streak,
      lastFive: t.lastFive,
      separatedBy,
    };
  });
}
