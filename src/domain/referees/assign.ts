/**
 * Proposes a ref for each game that has none (ADR 0053). It is pure: the
 * admin screen passes in the games, the ref pool with each ref's
 * availability and teams, and what each ref is already doing, and gets back
 * a proposal it can accept whole or game by game.
 *
 * Its promises, each a property test in assign.test.ts:
 * - A ref is proposed only for a game at a time they said they can work.
 * - Never for a game their own team plays (issue #296).
 * - Never for two games at once, or a game while their team is playing.
 * - Never for back-to-back games on different fields: a ref works a block
 *   on one field rather than crossing the park between games.
 * - Fair: no proposed game could go to another ref who can take it and has
 *   two or more fewer games this season.
 * - Complete: a game left without a ref has nobody left who could take it.
 */

/** A game to staff. Times are epoch milliseconds. */
export type AssignGame = {
  id: string;
  startsAt: number;
  endsAt: number;
  fieldId: string;
  teamSeasonIds: readonly string[];
};

/** Someone in the ref pool. */
export type AssignRef = {
  id: string;
  /** Start times (epoch ms) of the slots they said they can work. */
  available: ReadonlySet<number>;
  /** The teams they play on this season. */
  teamSeasonIds: ReadonlySet<string>;
};

/**
 * Something a ref is already doing: a game they already referee (which
 * counts toward their share) or one their team plays (which doesn't).
 */
export type Commitment = {
  refId: string;
  startsAt: number;
  endsAt: number;
  fieldId: string;
  counts: boolean;
};

export type Unfilled = {
  gameId: string;
  /** Nobody marked this time, or everyone who did is ruled out. */
  reason: "nobody_available" | "everyone_busy";
};

export type Proposal = {
  /** Game id to ref id, in game order. */
  assignments: ReadonlyMap<string, string>;
  unfilled: readonly Unfilled[];
  /** Games each ref would have this season, existing ones included. */
  loads: ReadonlyMap<string, number>;
};

/** Games closer than this, end to start, are back to back. */
export const BACK_TO_BACK_MS = 30 * 60_000;

type Busy = { startsAt: number; endsAt: number; fieldId: string };

const overlaps = (a: Busy, b: Busy) =>
  a.startsAt < b.endsAt && b.startsAt < a.endsAt;

/** Whether one follows the other with less than the gap between them. */
export const backToBack = (a: Busy, b: Busy) =>
  !overlaps(a, b) &&
  Math.min(Math.abs(b.startsAt - a.endsAt), Math.abs(a.startsAt - b.endsAt)) <
    BACK_TO_BACK_MS;

/**
 * The rules no assignment breaks, proposed or picked by hand: never the
 * ref's own team's game, and never a game while they ref or play another.
 */
export function allowed(
  ref: Pick<AssignRef, "teamSeasonIds">,
  game: AssignGame,
  busy: readonly Busy[],
): boolean {
  if (game.teamSeasonIds.some((t) => ref.teamSeasonIds.has(t))) return false;
  return busy.every((b) => !overlaps(b, game));
}

/**
 * Whether `game` fits a ref's day, given everything else they're doing: it
 * is allowed, they said they can work then, and it doesn't send them to
 * another field between back-to-back games. An admin picking by hand may
 * waive the last two; the assigner never does.
 */
export function fits(
  ref: AssignRef,
  game: AssignGame,
  busy: readonly Busy[],
): boolean {
  return (
    ref.available.has(game.startsAt) &&
    allowed(ref, game, busy) &&
    busy.every((b) => !(backToBack(b, game) && b.fieldId !== game.fieldId))
  );
}

const byGame = (a: AssignGame, b: AssignGame) =>
  a.startsAt - b.startsAt ||
  a.fieldId.localeCompare(b.fieldId) ||
  a.id.localeCompare(b.id);

export function proposeReferees(input: {
  games: readonly AssignGame[];
  refs: readonly AssignRef[];
  commitments: readonly Commitment[];
}): Proposal {
  const games = [...input.games].sort(byGame);
  const refs = [...input.refs].sort((a, b) => a.id.localeCompare(b.id));
  const assigned = new Map<string, string>();
  const load = new Map(refs.map((r) => [r.id, 0]));
  const loadOf = (refId: string) => load.get(refId) ?? 0;
  for (const c of input.commitments)
    if (c.counts && load.has(c.refId)) load.set(c.refId, loadOf(c.refId) + 1);

  /** What a ref is doing, apart from `except`. */
  const busyOf = (refId: string, except?: string): Busy[] => [
    ...input.commitments.filter((c) => c.refId === refId),
    ...games.filter((g) => g.id !== except && assigned.get(g.id) === refId),
  ];
  const take = (gameId: string, refId: string) => {
    const before = assigned.get(gameId);
    if (before) load.set(before, loadOf(before) - 1);
    assigned.set(gameId, refId);
    load.set(refId, loadOf(refId) + 1);
  };
  /** Whether the ref's other games put them on this field just before or after. */
  const staysOnField = (refId: string, game: AssignGame) =>
    busyOf(refId, game.id).some(
      (b) => backToBack(b, game) && b.fieldId === game.fieldId,
    );

  /** Gives unstaffed games to whoever can take them; true if any was given. */
  const fill = () => {
    let gave = false;
    for (const game of games) {
      if (assigned.has(game.id)) continue;
      const best = refs
        .filter((r) => fits(r, game, busyOf(r.id)))
        .sort(
          (a, b) =>
            loadOf(a.id) - loadOf(b.id) ||
            // Of equal shares, keep a ref on the field they're already on.
            Number(staysOnField(b.id, game)) - Number(staysOnField(a.id, game)),
        )[0];
      if (best) {
        take(game.id, best.id);
        gave = true;
      }
    }
    return gave;
  };

  /**
   * Moves games from refs with more to refs with at least two fewer until no
   * move is left. Each move lowers the sum of squared shares, so it ends.
   */
  const balance = () => {
    for (;;) {
      let moved = false;
      for (const game of games) {
        const from = assigned.get(game.id);
        if (!from) continue;
        const to = refs.find(
          (r) =>
            r.id !== from &&
            loadOf(from) - loadOf(r.id) >= 2 &&
            fits(r, game, busyOf(r.id, game.id)),
        );
        if (to) {
          take(game.id, to.id);
          moved = true;
        }
      }
      if (!moved) return;
    }
  };

  // Each round staffs at least one more game, so this ends too.
  fill();
  balance();
  while (fill()) balance();

  const unfilled = games
    .filter((g) => !assigned.has(g.id))
    .map((g): Unfilled => ({
      gameId: g.id,
      reason: refs.some((r) => r.available.has(g.startsAt))
        ? "everyone_busy"
        : "nobody_available",
    }));
  return {
    assignments: new Map(
      games.flatMap((g) => {
        const r = assigned.get(g.id);
        return r ? [[g.id, r] as const] : [];
      }),
    ),
    unfilled,
    loads: load,
  };
}
