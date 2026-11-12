import { seededRandom } from "../random";
import { constructPlacement } from "./placement";
import { assignRoundsToDates, buildRounds, type Round } from "./rounds";
import { localSearch, type SearchOptions } from "./search";
import type { Schedule, SchedulerInput } from "./types";
import { validate } from "./validate";

/**
 * Builds a full season schedule (scheduling-algorithm.md, section 4).
 *
 * Stage A builds round-robin rounds for each division pool; rounds with the
 * same number are played together, so every pool shares the slots and
 * fairness is balanced league-wide. Stage B gives rounds dates, C1 places
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

  const rounds: Round[] = [];
  const byes: Schedule["byes"] = [];
  for (let r = 1; r <= input.rounds; r++) {
    const parts = poolRounds
      .map((p) => p[r - 1])
      .filter((p) => p !== undefined);
    if (parts.length === 0) break;
    rounds.push({ round: r, games: parts.flatMap((p) => p.games), bye: null });
    for (const part of parts)
      if (part.bye !== null) byes.push({ round: r, teamId: part.bye });
  }

  const dated = assignRoundsToDates(rounds, input);
  const placed = constructPlacement(rounds, dated.days, input);
  const searched = localSearch({ ...placed, byes }, input, random, options);
  const violations = validate(input, searched);

  return {
    ...searched,
    diagnostics: [
      ...dated.diagnostics,
      ...placed.diagnostics,
      ...violations.map((v) => `${v.rule}: ${v.message}`),
    ],
  };
}
