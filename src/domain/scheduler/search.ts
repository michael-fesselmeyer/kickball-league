import type { Random } from "../random";
import {
  costContext,
  fieldDayCost,
  fieldDays,
  roundCost,
  teamCostAt,
  type Position,
} from "./cost";
import type { Schedule, SchedulerInput, Slot } from "./types";

export type SearchOptions = {
  /** Default: 5,000 per game day, so run time is predictable. */
  iterations?: number;
  /** Starting temperature, in cost units. Default: the S1 weight. */
  startTemperature?: number;
  /** Share of moves that swap whole time rows or fields on a day. */
  blockSwapShare?: number;
  /** Share of single moves aimed at the costliest teams. */
  aimedShare?: number;
};

const ITERATIONS_PER_DAY = 5_000;
const MIN_TEMPERATURE = 0.5;
const TOURNAMENT = 4;
/** Share of single moves aimed at the costliest teams. */
const AIMED_SHARE = 0.5;
/** Share of moves that swap whole time rows or fields on a day. */
const BLOCK_SWAP_SHARE = 0.2;

/**
 * Stage C2 (scheduling-algorithm.md, section 4): simulated annealing over
 * the whole season.
 *
 * A move swaps two games on one date, or moves a game to an empty regular
 * slot on its date. Moves never touch locked games and are undone when they
 * would put a team in two games at once (H2) or in a slot it cannot make
 * (H4); staying on the same date keeps every other hard constraint as it
 * was. Only the teams and field-days a move touches are re-priced. The best
 * schedule seen is returned, so the search never makes the cost worse (P7).
 */
export function localSearch(
  schedule: Schedule,
  input: SchedulerInput,
  random: Random,
  options: SearchOptions = {},
): Schedule {
  const ctx = costContext(input);
  const k = ctx.timeIndexes.length;
  const days = ctx.dates.length;
  const games = schedule.games;

  const teamIndex = new Map(input.teams.map((t, i) => [t.id, i]));
  const teamsOf = games.map(
    (g) =>
      [teamIndex.get(g.teamA) ?? -1, teamIndex.get(g.teamB) ?? -1] as const,
  );
  const teamGames: number[][] = input.teams.map(() => []);
  teamsOf.forEach(([a, b], i) => {
    teamGames[a]?.push(i);
    teamGames[b]?.push(i);
  });

  // Where each game is, as a cost position; playoff games are left alone.
  const at: (Position | undefined)[] = games.map((g) =>
    g.slotId === null ? undefined : ctx.position.get(g.slotId),
  );
  const occupant = new Map<string, number>();
  at.forEach((p, i) => p && occupant.set(p.slot.id, i));

  const locked = new Set(input.locked.map((l) => l.gameKey));
  const movable = games.flatMap((g, i) =>
    at[i]?.slot.kind === "regular" && !locked.has(g.key) ? [i] : [],
  );
  const regularByDay: Position[][] = ctx.dates.map(() => []);
  for (const p of ctx.position.values())
    if (p.slot.kind === "regular") regularByDay[p.day]?.push(p);

  const gameDays = new Set(movable.map((i) => (at[i] as Position).day)).size;
  const iterations =
    options.iterations ?? ITERATIONS_PER_DAY * Math.max(1, gameDays);
  if (movable.length === 0 || iterations <= 0) return schedule;

  const unavailable = input.teams.map((t) =>
    input.constraints.filter(
      (c) => c.kind === "unavailable" && c.teamId === t.id,
    ),
  );
  const canPlay = (team: number, slot: Slot) =>
    !(unavailable[team] ?? []).some(
      (c) =>
        (c.date === undefined || c.date === slot.date) &&
        (c.timeIndex === undefined || c.timeIndex === slot.timeIndex),
    );

  // Games per team, date and time index, for H2.
  const busy = new Int16Array(Math.max(1, input.teams.length * days * k));
  const cell = (team: number, p: Position) =>
    (team * days + p.day) * k + p.time;
  const mark = (i: number, p: Position, by: number) => {
    for (const team of teamsOf[i] as readonly number[])
      if (team >= 0) busy[cell(team, p)] = (busy[cell(team, p)] as number) + by;
  };
  at.forEach((p, i) => p && mark(i, p, 1));

  const fieldDaySlots = fieldDays(input);
  const fieldDayKey = (p: Position) => `${p.slot.fieldId}\u0000${p.slot.date}`;
  const occupied = (id: string) => occupant.has(id);
  const positions: Position[] = [];
  const priceTeam = (team: number) => {
    positions.length = 0;
    for (const i of teamGames[team] ?? []) {
      const p = at[i];
      if (p) positions.push(p);
    }
    return teamCostAt(ctx, input.teams[team]?.id ?? "", positions);
  };
  const priceFieldDay = (key: string) =>
    fieldDayCost(ctx, fieldDaySlots.get(key) ?? [], occupied);

  const teamCosts = input.teams.map((_, t) => priceTeam(t));
  const fieldDayCosts = new Map(
    [...fieldDaySlots.keys()].map((key) => [key, priceFieldDay(key)]),
  );
  let current = roundCost(input, schedule);
  for (const c of teamCosts) current += c;
  for (const c of fieldDayCosts.values()) current += c;
  let best = current;
  let bestAt = at.slice();

  /** Puts game i at `p`, keeping occupancy and H2 counts in step. */
  const put = (i: number, p: Position | undefined) => {
    const from = at[i];
    if (from) {
      mark(i, from, -1);
      if (occupant.get(from.slot.id) === i) occupant.delete(from.slot.id);
    }
    at[i] = p;
    if (p) {
      mark(i, p, 1);
      occupant.set(p.slot.id, i);
    }
  };
  const legalAt = (i: number) => {
    const p = at[i] as Position;
    return (teamsOf[i] as readonly number[]).every(
      (team) =>
        team < 0 || (busy[cell(team, p)] === 1 && canPlay(team, p.slot)),
    );
  };

  // Movable games per team, for moves aimed at the costliest teams.
  const movableSet = new Set(movable);
  const teamMovable = teamGames.map((list) =>
    list.filter((i) => movableSet.has(i)),
  );
  /**
   * Half the moves take a random game; the other half take a game of the
   * costliest of a few sampled teams, which spends the effort where the
   * penalties are.
   */
  const aimedShare = options.aimedShare ?? AIMED_SHARE;
  const pickGame = () => {
    if (random.next() >= aimedShare)
      return movable[Math.floor(random.next() * movable.length)] as number;
    let worst = -1;
    for (let s = 0; s < TOURNAMENT; s++) {
      const t = Math.floor(random.next() * teamCosts.length);
      if (worst < 0 || (teamCosts[t] as number) > (teamCosts[worst] as number))
        worst = t;
    }
    const own = teamMovable[worst] ?? [];
    return own.length === 0
      ? -1
      : (own[Math.floor(random.next() * own.length)] as number);
  };

  // Regular slots by day, time position and field, for row and column swaps.
  const cellKey = (day: number, time: number, field: number) =>
    (day * k + time) * ctx.fields.length + field;
  const grid = new Map<number, Position>();
  for (const p of ctx.position.values())
    if (p.slot.kind === "regular") grid.set(cellKey(p.day, p.time, p.field), p);
  const isLocked = (i: number | undefined) =>
    i !== undefined && locked.has((games[i] as { key: string }).key);

  /** One game to another slot on its day, swapping with any game there. */
  const singleMove = (): [number, Position][] | null => {
    const i = pickGame();
    if (i < 0) return null;
    const from = at[i] as Position;
    const sameDay = regularByDay[from.day] as Position[];
    const to = sameDay[Math.floor(random.next() * sameDay.length)] as Position;
    const other = occupant.get(to.slot.id);
    if (to === from || isLocked(other)) return null;
    return other === undefined
      ? [[i, to]]
      : [
          [i, to],
          [other, from],
        ];
  };

  /**
   * Two whole time rows (or two whole fields) on one day trade places. Teams
   * keep their games and opponents, so these big moves cannot double-book a
   * team on a single-game day, and they shift many teams' balance at once.
   */
  const blockSwap = (rows: boolean): [number, Position][] | null => {
    const i = movable[Math.floor(random.next() * movable.length)] as number;
    const day = (at[i] as Position).day;
    const size = rows ? k : ctx.fields.length;
    const a = Math.floor(random.next() * size);
    const b = Math.floor(random.next() * size);
    if (a === b) return null;
    const moves: [number, Position][] = [];
    const across = rows ? ctx.fields.length : k;
    for (let x = 0; x < across; x++) {
      const pa = grid.get(rows ? cellKey(day, a, x) : cellKey(day, x, a));
      const pb = grid.get(rows ? cellKey(day, b, x) : cellKey(day, x, b));
      if (!pa || !pb) continue;
      const ga = occupant.get(pa.slot.id);
      const gb = occupant.get(pb.slot.id);
      if (isLocked(ga) || isLocked(gb)) return null;
      if (ga !== undefined) moves.push([ga, pb]);
      if (gb !== undefined) moves.push([gb, pa]);
    }
    return moves.length > 0 ? moves : null;
  };

  const blockShare = options.blockSwapShare ?? BLOCK_SWAP_SHARE;
  const t0 = options.startTemperature ?? input.weights.timeBalance;
  for (let step = 0; step < iterations; step++) {
    const temperature = t0 * (1 - step / iterations) + MIN_TEMPERATURE;
    const roll = random.next();
    const moves =
      roll < blockShare / 2
        ? blockSwap(true)
        : roll < blockShare
          ? blockSwap(false)
          : singleMove();
    if (!moves) continue;

    const origins = moves.map(([i]) => at[i] as Position);
    for (const [i] of moves) put(i, undefined);
    for (const [i, to] of moves) put(i, to);
    const undo = () => {
      for (const [i] of moves) put(i, undefined);
      moves.forEach(([i], m) => put(i, origins[m]));
    };
    if (!moves.every(([i]) => legalAt(i))) {
      undo();
      continue;
    }

    const teams = new Set<number>();
    for (const [i] of moves) for (const t of teamsOf[i] ?? []) teams.add(t);
    teams.delete(-1);
    const keys = new Set<string>();
    moves.forEach(([, to], m) => {
      keys.add(fieldDayKey(to));
      keys.add(fieldDayKey(origins[m] as Position));
    });

    let delta = 0;
    const newTeamCosts: [number, number][] = [];
    for (const t of teams) {
      const c = priceTeam(t);
      newTeamCosts.push([t, c]);
      delta += c - (teamCosts[t] as number);
    }
    const newFieldDayCosts: [string, number][] = [];
    for (const key of keys) {
      const c = priceFieldDay(key);
      newFieldDayCosts.push([key, c]);
      delta += c - (fieldDayCosts.get(key) ?? 0);
    }

    if (delta <= 0 || random.next() < Math.exp(-delta / temperature)) {
      for (const [t, c] of newTeamCosts) teamCosts[t] = c;
      for (const [key, c] of newFieldDayCosts) fieldDayCosts.set(key, c);
      current += delta;
      if (current < best - 1e-9) {
        best = current;
        bestAt = at.slice();
      }
    } else {
      undo();
    }
  }

  // Games the search never saw (unplaced, or in playoff slots) stay as they were.
  return {
    ...schedule,
    games: games.map((g, i) => {
      const best = bestAt[i];
      return best ? { ...g, slotId: best.slot.id } : g;
    }),
  };
}
