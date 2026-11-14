import { err, ok, type Result } from "../result";

/**
 * Pick'em (ADR 0044): players predict each game day's winners, for
 * bragging rights only. No money, no entry fee, no prizes. These rules are
 * pure; src/db/queries/pickem.ts reads and writes the picks.
 *
 * - A game is open for picks until its start time, while it is still
 *   scheduled in an open slot. Each game locks on its own.
 * - A pick is scored only when the result is confirmed: a final score with
 *   a winner is right or wrong. A forfeit, a tie, a cancellation, a
 *   postponement, a rain-out (the slot was called off) or a move to another
 *   slot voids it: it counts for nobody.
 * - Leaderboards rank by correct picks; equal counts share a place.
 */

export type GameStatus =
  "scheduled" | "in_progress" | "final" | "postponed" | "cancelled" | "forfeit";

/** What the rules need to know about a game. */
export type PickemGame = {
  status: GameStatus;
  teamAId: string;
  teamBId: string;
  slotId: string | null;
  /** The slot's start; null when the game has no slot. */
  startsAt: Date | null;
  /** The slot was called off, as for a rain-out. */
  slotCancelled: boolean;
  scoreA: number | null;
  scoreB: number | null;
};

/** Whether picks for the game are closed at `now`. */
export function isLocked(
  g: Pick<PickemGame, "status" | "startsAt" | "slotCancelled">,
  now: Date,
): boolean {
  return (
    g.status !== "scheduled" ||
    g.startsAt === null ||
    g.slotCancelled ||
    now.getTime() >= g.startsAt.getTime()
  );
}

export type VoidReason =
  "forfeit" | "tie" | "cancelled" | "postponed" | "rained_out" | "moved";

export type GameResult =
  | { kind: "pending" }
  | { kind: "void"; reason: VoidReason }
  | { kind: "won"; winner: string };

/** The game's result for pick'em, from its confirmed outcome only. */
export function gameResult(g: PickemGame): GameResult {
  if (g.status === "forfeit") return { kind: "void", reason: "forfeit" };
  if (g.status === "cancelled") return { kind: "void", reason: "cancelled" };
  if (g.status === "postponed") return { kind: "void", reason: "postponed" };
  if (g.slotCancelled) return { kind: "void", reason: "rained_out" };
  if (g.status !== "final" || g.scoreA === null || g.scoreB === null)
    return { kind: "pending" };
  if (g.scoreA === g.scoreB) return { kind: "void", reason: "tie" };
  return {
    kind: "won",
    winner: g.scoreA > g.scoreB ? g.teamAId : g.teamBId,
  };
}

export type PickOutcome = "pending" | "void" | "correct" | "wrong";

/**
 * How a pick scored. A pick made for another slot than the game's current
 * one (the game moved, or its slot went) is void, whatever happens later.
 */
export function pickOutcome(
  pick: { teamSeasonId: string; slotId: string | null },
  g: PickemGame,
): PickOutcome {
  if (pick.slotId === null || pick.slotId !== g.slotId) return "void";
  const result = gameResult(g);
  if (result.kind === "won")
    return result.winner === pick.teamSeasonId ? "correct" : "wrong";
  return result.kind;
}

export type PickError = "locked" | "not_in_game" | "own_team";

/**
 * Whether a player may pick `teamSeasonId` to win `g` at `now`. `myTeams`
 * are the player's own teams that season; `ownGamesAllowed` is the league's
 * setting.
 */
export function checkPick(
  g: PickemGame,
  teamSeasonId: string,
  context: {
    now: Date;
    myTeams: readonly string[];
    ownGamesAllowed: boolean;
  },
): Result<void, PickError> {
  if (teamSeasonId !== g.teamAId && teamSeasonId !== g.teamBId)
    return err("not_in_game");
  if (isLocked(g, context.now)) return err("locked");
  if (!context.ownGamesAllowed && playsIn(g, context.myTeams))
    return err("own_team");
  return ok(undefined);
}

/** Whether one of the player's teams plays in the game. */
export const playsIn = (
  g: Pick<PickemGame, "teamAId" | "teamBId">,
  myTeams: readonly string[],
) => myTeams.includes(g.teamAId) || myTeams.includes(g.teamBId);

/** An instant's date on the league's wall clock, as YYYY-MM-DD. */
export function gameDayOf(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * The coming game day: the league-time date of the earliest game still open
 * for picks. Null when no game is open. Later games that day stay on the
 * page after the first one locks.
 */
export function comingGameDay(
  games: readonly Pick<PickemGame, "status" | "startsAt" | "slotCancelled">[],
  now: Date,
  timeZone: string,
): string | null {
  let first: Date | null = null;
  for (const g of games)
    if (!isLocked(g, now) && g.startsAt && (!first || g.startsAt < first))
      first = g.startsAt;
  return first ? gameDayOf(first, timeZone) : null;
}

export type BoardRow = {
  userId: string;
  name: string;
  correct: number;
  /** Picks scored right or wrong, for "7 of 10". */
  scored: number;
};

export type RankedRow = BoardRow & { place: number };

/**
 * Ranks a leaderboard by correct picks, most first. Players with the same
 * number share a place and the next place is skipped (1, 2, 2, 4). Within a
 * place, fewer scored picks (a better rate) and then the name order the rows.
 */
export function rankBoard(rows: readonly BoardRow[]): RankedRow[] {
  const sorted = [...rows].sort(
    (a, b) =>
      b.correct - a.correct ||
      a.scored - b.scored ||
      a.name.localeCompare(b.name) ||
      a.userId.localeCompare(b.userId),
  );
  let place = 0;
  return sorted.map((row, i) => {
    if (i === 0 || row.correct !== (sorted[i - 1] as BoardRow).correct)
      place = i + 1;
    return { ...row, place };
  });
}

/** "1st", "2nd", "3rd", "4th", "11th", "21st". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix = ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** A shared place reads "T-2nd". */
export function placeLabel(row: RankedRow, rows: readonly RankedRow[]) {
  const shared = rows.filter((r) => r.place === row.place).length > 1;
  return `${shared ? "T-" : ""}${ordinal(row.place)}`;
}

/** A game day (YYYY-MM-DD) as "Tue, Oct 6". */
export function dayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
}

/** A game day from the URL: a real date, or nothing. */
export function readDay(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
    ? null
    : value;
}
