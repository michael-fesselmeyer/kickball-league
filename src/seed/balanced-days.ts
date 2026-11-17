/**
 * Where each seeded game goes on its game day: which kickoff (time index)
 * and which field, so the published schedule reads as a fair one on the
 * schedule screen (src/domain/scheduler/measure.ts). For every team:
 * - games at each kickoff differ by at most one (time-slot spread),
 * - games on each field differ by at most one (field spread),
 * - never more than two game days in a row at the same kickoff.
 * Each game day uses the same number of games at each kickoff.
 *
 * Pure and deterministic: a depth-first search over each round's
 * placements, in a fixed order, so a reseed gives the same schedule.
 */

export type Placement = { timeIndex: number; field: number };

type Pair = readonly [number, number];

/** Every way to choose `k` of `0..n-1`, in order. */
function choose(n: number, k: number): number[][] {
  if (k === 0) return [[]];
  if (n < k) return [];
  return [
    ...choose(n - 1, k - 1).map((c) => [...c, n - 1]),
    ...choose(n - 1, k),
  ];
}

/** Every ordering of a list, in a fixed order. */
function orderings<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    orderings([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

/** The slots one game day could use: the same number of games at each kickoff. */
function daySlotChoices(
  games: number,
  times: number,
  fields: number,
): Placement[][] {
  if (games % times !== 0 || games / times > fields)
    throw new Error(`Cannot spread ${games} games over ${times} kickoffs`);
  const perTime = games / times;
  let choices: Placement[][] = [[]];
  for (let t = 0; t < times; t++)
    choices = choices.flatMap((sofar) =>
      choose(fields, perTime).map((fs) => [
        ...sofar,
        ...fs.map((field) => ({ timeIndex: t, field })),
      ]),
    );
  return choices;
}

export function balancedGameDays(
  rounds: readonly (readonly Pair[])[],
  options: { teams: number; times: number; fields: number },
): Placement[][] {
  const { teams, times, fields } = options;
  const games = rounds.length;
  const maxPerTime = Math.ceil(games / times);
  const minPerTime = Math.floor(games / times);
  const maxPerField = Math.ceil(games / fields);
  const minPerField = Math.floor(games / fields);
  const byTime = Array.from({ length: teams }, () => Array(times).fill(0));
  const byField = Array.from({ length: teams }, () => Array(fields).fill(0));
  const lastTimes: number[][] = Array.from({ length: teams }, () => []);
  const placed: Placement[][] = [];

  const fits = (team: number, p: Placement, left: number) => {
    const t = byTime[team] as number[];
    const f = byField[team] as number[];
    if ((t[p.timeIndex] ?? 0) + 1 > maxPerTime) return false;
    if ((f[p.field] ?? 0) + 1 > maxPerField) return false;
    const recent = lastTimes[team] as number[];
    if (recent.length >= 2 && recent.slice(-2).every((x) => x === p.timeIndex))
      return false;
    // Enough rounds left to bring every kickoff and field up to its minimum.
    const short = (counts: number[], min: number, add: number) =>
      counts.reduce(
        (sum, c, i) => sum + Math.max(0, min - c - (i === add ? 1 : 0)),
        0,
      );
    return (
      short(t, minPerTime, p.timeIndex) <= left &&
      short(f, minPerField, p.field) <= left
    );
  };
  const apply = (team: number, p: Placement, by: 1 | -1) => {
    const t = byTime[team] as number[];
    const f = byField[team] as number[];
    t[p.timeIndex] = (t[p.timeIndex] ?? 0) + by;
    f[p.field] = (f[p.field] ?? 0) + by;
    if (by === 1) (lastTimes[team] as number[]).push(p.timeIndex);
    else (lastTimes[team] as number[]).pop();
  };

  const search = (round: number): boolean => {
    const pairs = rounds[round];
    if (!pairs) return true;
    const left = games - round - 1;
    for (const day of daySlotChoices(pairs.length, times, fields))
      for (const order of orderings(day)) {
        if (
          !pairs.every(
            ([a, b], i) =>
              fits(a, order[i] as Placement, left) &&
              fits(b, order[i] as Placement, left),
          )
        )
          continue;
        pairs.forEach(([a, b], i) => {
          apply(a, order[i] as Placement, 1);
          apply(b, order[i] as Placement, 1);
        });
        placed.push(order);
        if (search(round + 1)) return true;
        placed.pop();
        pairs.forEach(([a, b], i) => {
          apply(a, order[i] as Placement, -1);
          apply(b, order[i] as Placement, -1);
        });
      }
    return false;
  };
  if (!search(0)) throw new Error("No balanced placement for the seed rounds");
  return placed;
}
