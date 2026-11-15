import { allowed, type AssignGame, type Commitment } from "./assign";

/**
 * Covering a game that lost its ref, or never had one (issue #389): who is
 * asked, and until when a ref may drop a game. Pure; the queries in
 * src/db/queries/referee-cover.ts feed it.
 *
 * Its promises, each tested in cover.test.ts:
 * - Nobody playing at that time is asked, nor anyone whose team plays in
 *   the game, nor anyone already reffing another game then.
 * - The ref who just dropped the game isn't asked to take it back.
 * - Everyone else the league counts as a ref is asked, once.
 */

/** Games that start within this long, with no ref, ask the pool. */
export const ASK_WINDOW_MS = 24 * 60 * 60_000;

/** The longest reason a ref may give for dropping a game. */
export const DROP_REASON_MAX = 200;

/** Someone the league counts as a ref, with the teams they play on. */
export type CoverRef<Id extends string = string> = {
  id: Id;
  teamSeasonIds: ReadonlySet<string>;
};

/**
 * Who to ask to take `game`, in the order given: everyone in `refs` that
 * the hard assignment rules allow, apart from `exclude`.
 */
export function whoToAsk<Id extends string>(input: {
  game: AssignGame;
  refs: readonly CoverRef<Id>[];
  commitments: readonly Commitment[];
  exclude?: ReadonlySet<string>;
}): Id[] {
  const busy = Map.groupBy(input.commitments, (c) => c.refId);
  const seen = new Set<string>();
  return input.refs.flatMap((r) => {
    if (seen.has(r.id) || input.exclude?.has(r.id)) return [];
    seen.add(r.id);
    return allowed(r, input.game, busy.get(r.id) ?? []) ? [r.id] : [];
  });
}

/** Whether a game starting at `startsAt` is close enough to ask the pool. */
export const withinAskWindow = (startsAt: Date, now: Date) =>
  startsAt > now && startsAt.getTime() - now.getTime() <= ASK_WINDOW_MS;

/** A ref may drop a game until it starts. */
export const canDrop = (startsAt: Date, now: Date) => startsAt > now;

/** The reason a ref gave for dropping, trimmed, or null if it's unusable. */
export function parseDropReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const reason = raw.replace(/\s+/g, " ").trim();
  return reason.length > 0 && reason.length <= DROP_REASON_MAX ? reason : null;
}
