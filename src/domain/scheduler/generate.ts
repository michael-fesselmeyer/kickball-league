import { seededRandom } from "../random";
import { constructPlacement } from "./placement";
import {
  assignRoundsToDates,
  buildCrossoverRounds,
  buildRounds,
  type Round,
} from "./rounds";
import { localSearch, type SearchOptions } from "./search";
import { gameKey, type Schedule, type SchedulerInput } from "./types";
import { validate } from "./validate";

/**
 * Builds a full season schedule (scheduling-algorithm.md, section 4).
 *
 * Stage A builds round-robin rounds for each division pool; rounds with the
 * same number are played together, so every pool shares the slots and
 * fairness is balanced league-wide. Crossover rounds between two divisions
 * are spread through the season. Stage B gives rounds dates, C1 places
 * each day, C2 improves the whole season, and D validates the result
 * independently. The same input always gives the same schedule.
 *
 * Anything that could not be done is explained in `diagnostics`, including
 * any hard-constraint violation Stage D finds (which would be a bug, or locks
 * that contradict each other); nothing is dropped silently.
 */
export function generate(
  input: SchedulerInput,
  options: SearchOptions = {},
): Schedule {
  const random = seededRandom(input.seed);
  const pools = [
    ...Map.groupBy(input.teams, (t) => t.divisionId ?? "").values(),
  ];
  const poolRounds = pools.map((pool) =>
    buildRounds(
      pool.map((t) => t.id),
      input.rounds,
      random,
    ),
  );

  // Rounds with the same number are played together, so the pools share
  // the slots.
  const divisionRounds: { games: Round["games"]; byes: string[] }[] = [];
  for (let r = 1; r <= input.rounds; r++) {
    const parts = poolRounds
      .map((p) => p[r - 1])
      .filter((p) => p !== undefined);
    if (parts.length === 0) break;
    divisionRounds.push({
      games: parts.flatMap((p) => p.games),
      byes: parts.flatMap((p) => (p.bye === null ? [] : [p.bye])),
    });
  }

  // Crossover rounds between two divisions, spread evenly through the
  // season; each team's division rounds keep their order, so H5 holds.
  const crossoverGames = input.crossoverGames ?? 0;
  const notes: string[] = [];
  const [first, second] = pools;
  const crossovers =
    pools.length === 2 && first && second
      ? buildCrossoverRounds(
          first.map((t) => t.id),
          second.map((t) => t.id),
          crossoverGames,
          random,
        )
      : [];
  if (crossoverGames > 0 && pools.length !== 2)
    notes.push(
      "Crossover games need exactly two divisions, so none were scheduled.",
    );
  const sequence = [...divisionRounds];
  for (const [c, crossover] of [...crossovers.entries()].reverse()) {
    const after = Math.floor(
      ((c + 1) * divisionRounds.length) / (crossovers.length + 1),
    );
    sequence.splice(after, 0, crossover);
  }
  const rounds: Round[] = sequence.map((part, i) => ({
    round: i + 1,
    games: part.games,
    bye: null,
  }));
  const byes: Schedule["byes"] = sequence.flatMap((part, i) =>
    part.byes.map((teamId) => ({ round: i + 1, teamId })),
  );

  // Stage B can give a date rounds that no placement fits, for example two
  // rounds when a team can make only some of the times, or one round with a
  // game whose teams share no time that date. When a date strands a game,
  // cap it at one round fewer (none, for a single round) and try again; caps
  // only shrink, so this ends. Keep the attempt that places the most games.
  // A pinned game keeps its round on the pinned slot's date.
  const roundOf = new Map(
    rounds.flatMap((r) =>
      r.games.map(([a, b]) => [gameKey(r.round, a, b), r.round] as const),
    ),
  );
  const slotDate = new Map(input.slots.map((s) => [s.id, s.date]));
  const pinned = new Map<number, string>();
  for (const lock of input.locked) {
    const round = roundOf.get(lock.gameKey);
    const date = slotDate.get(lock.slotId);
    if (round !== undefined && date !== undefined && !pinned.has(round))
      pinned.set(round, date);
  }

  const roundCap = new Map<string, number>();
  let best: {
    dated: ReturnType<typeof assignRoundsToDates>;
    placed: Schedule;
  } | null = null;
  for (;;) {
    const dated = assignRoundsToDates(rounds, input, roundCap, pinned);
    const placed = constructPlacement(rounds, dated.days, input);
    if (!best || placed.unplaced.length < best.placed.unplaced.length)
      best = { dated, placed };
    const stranded = new Set(
      placed.games.filter((g) => g.slotId === null).map((g) => g.round),
    );
    const tight = dated.days.filter((d) =>
      d.rounds.some((r) => stranded.has(r)),
    );
    // Cap only where that moves an unpinned round off the date; stop when
    // nothing more can change.
    let changed = false;
    for (const day of tight) {
      const cap = day.rounds.length - 1;
      const movable = day.rounds.some((r) => pinned.get(r) !== day.date);
      if (movable && cap < (roundCap.get(day.date) ?? Infinity)) {
        roundCap.set(day.date, cap);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const { dated, placed } = best;
  const searched = localSearch({ ...placed, byes }, input, random, options);
  const violations = validate(input, searched);

  return {
    ...searched,
    diagnostics: [
      ...notes,
      ...dated.diagnostics,
      ...placed.diagnostics,
      ...violations.map((v) => `${v.rule}: ${v.message}`),
    ],
  };
}
