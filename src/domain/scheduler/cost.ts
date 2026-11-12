import type { Schedule, SchedulerInput, Slot, TeamConstraint } from "./types";

/**
 * The soft-constraint cost (scheduling-algorithm.md, section 2): S1 to S9,
 * weighted and summed. Lower is better.
 *
 * It is split into parts that each depend on one team or one field on one
 * date, so a move in the local search re-prices only the two to four teams
 * and two field-days it touches. Slots are turned into small integer
 * positions once, because the search prices hundreds of thousands of moves.
 */
export type Position = {
  slot: Slot;
  /** Index into `CostContext.timeIndexes`. */
  time: number;
  /** Index into `CostContext.fields`. */
  field: number;
  /** Index of the slot's date among all season dates. */
  day: number;
};

export type CostContext = {
  input: SchedulerInput;
  timeIndexes: number[];
  fields: string[];
  dates: string[];
  position: Map<string, Position>;
  preferences: Map<string, TeamConstraint[]>;
};

export function costContext(input: SchedulerInput): CostContext {
  const season = input.slots.filter((s) => s.kind !== "playoff");
  const timeIndexes = [...new Set(season.map((s) => s.timeIndex))].sort(
    (a, b) => a - b,
  );
  const fields = [...new Set(season.map((s) => s.fieldId))].sort();
  const dates = [...new Set(season.map((s) => s.date))].sort();
  const position = new Map(
    season.map((slot) => [
      slot.id,
      {
        slot,
        time: timeIndexes.indexOf(slot.timeIndex),
        field: fields.indexOf(slot.fieldId),
        day: dates.indexOf(slot.date),
      },
    ]),
  );
  const preferences = new Map<string, TeamConstraint[]>();
  for (const c of input.constraints) {
    if (c.kind === "unavailable") continue;
    preferences.set(c.teamId, [...(preferences.get(c.teamId) ?? []), c]);
  }
  return { input, timeIndexes, fields, dates, position, preferences };
}

function balancePenalty(counts: Int32Array): number {
  if (counts.length === 0) return 0;
  let most = counts[0] as number;
  let least = most;
  for (const c of counts) {
    if (c > most) most = c;
    if (c < least) least = c;
  }
  const excess = most - least - 1;
  return excess > 0 ? excess * excess : 0;
}

const byDayThenTime = (a: Position, b: Position) =>
  a.day - b.day || a.time - b.time;

/** S1, S2, S3, S4, S6 and S9 for one team, given where it plays. */
export function teamCostAt(
  ctx: CostContext,
  teamId: string,
  games: readonly Position[],
): number {
  const w = ctx.input.weights;
  const k = ctx.timeIndexes.length;
  const byTime = new Int32Array(k);
  const byField = new Int32Array(ctx.fields.length);
  for (const p of games) {
    byTime[p.time] = (byTime[p.time] as number) + 1;
    byField[p.field] = (byField[p.field] as number) + 1;
  }
  let cost =
    w.timeBalance * balancePenalty(byTime) +
    w.fieldBalance * balancePenalty(byField);

  // S9: squared distance from an even split over time indexes.
  if (k > 0) {
    const ideal = games.length / k;
    for (const count of byTime) cost += w.fineBalance * (count - ideal) ** 2;
  }

  const ordered = games.length > 1 ? [...games].sort(byDayThenTime) : games;

  // S3: each game day beyond 2 in a row at the same time index.
  // S4: idle slots between a team's games on one day.
  const run = new Int32Array(k);
  for (let i = 0; i < ordered.length;) {
    const day = (ordered[i] as Position).day;
    let j = i;
    const today = new Uint8Array(k);
    while (j < ordered.length && (ordered[j] as Position).day === day) {
      const p = ordered[j] as Position;
      today[p.time] = 1;
      if (j > i)
        cost +=
          w.doubleheaderWait *
          (p.slot.timeIndex - (ordered[j - 1] as Position).slot.timeIndex - 1);
      j++;
    }
    for (let t = 0; t < k; t++) {
      run[t] = today[t] ? (run[t] as number) + 1 : 0;
      if ((run[t] as number) > 2) cost += w.streaks;
    }
    i = j;
  }

  // S6: preferences not met, times their weight.
  for (const c of ctx.preferences.get(teamId) ?? []) {
    const weight = w.preferences * (c.weight ?? 1);
    if (c.timeIndex !== undefined) {
      for (const p of games)
        if (
          (c.date === undefined || p.slot.date === c.date) &&
          (p.slot.timeIndex === c.timeIndex) !== (c.kind === "prefer")
        )
          cost += weight;
    } else if (c.date !== undefined) {
      const plays = games.some((p) => p.slot.date === c.date);
      if (plays !== (c.kind === "prefer")) cost += weight;
    }
  }
  return cost;
}

/** `teamCostAt` for a list of slots. */
export function teamCost(
  ctx: CostContext,
  teamId: string,
  slots: readonly Slot[],
): number {
  return teamCostAt(
    ctx,
    teamId,
    slots.flatMap((s) => {
      const p = ctx.position.get(s.id);
      return p ? [p] : [];
    }),
  );
}

/** S5: empty slots between two games on one field on one date. */
export function fieldDayCost(
  ctx: CostContext,
  slots: readonly Slot[],
  occupied: (slotId: string) => boolean,
): number {
  let first = Infinity;
  let last = -Infinity;
  for (const s of slots)
    if (occupied(s.id)) {
      first = Math.min(first, s.timeIndex);
      last = Math.max(last, s.timeIndex);
    }
  let between = 0;
  for (const s of slots)
    if (s.timeIndex > first && s.timeIndex < last && !occupied(s.id)) between++;
  return ctx.input.weights.idleFields * between;
}

/** Regular-season slots grouped by field and date. */
export function fieldDays(input: SchedulerInput): Map<string, Slot[]> {
  return Map.groupBy(
    input.slots.filter((s) => s.kind !== "playoff"),
    (s) => `${s.fieldId}\u0000${s.date}`,
  );
}

/**
 * S7 and S8, which depend only on rounds and byes. Local search never
 * changes them, but they belong to the season's cost.
 */
export function roundCost(input: SchedulerInput, schedule: Schedule): number {
  const w = input.weights;
  let cost = 0;
  const target = Math.max(0, input.teams.length - 2);
  for (const games of Map.groupBy(schedule.games, (g) =>
    [g.teamA, g.teamB].sort().join("\u0000"),
  ).values()) {
    const rounds = games.map((g) => g.round).sort((a, b) => a - b);
    for (let i = 1; i < rounds.length; i++) {
      const gap = (rounds[i] as number) - (rounds[i - 1] as number);
      if (gap < target) cost += w.rematchSpacing * (target - gap);
    }
  }
  for (const byes of Map.groupBy(schedule.byes, (b) => b.teamId).values()) {
    const rounds = byes.map((b) => b.round).sort((a, b) => a - b);
    for (let i = 1; i < rounds.length; i++)
      if ((rounds[i] as number) - (rounds[i - 1] as number) === 1)
        cost += w.backToBackByes;
  }
  return cost;
}

/** The whole season's soft-constraint cost. */
export function scheduleCost(
  input: SchedulerInput,
  schedule: Schedule,
): number {
  const ctx = costContext(input);
  const placed = schedule.games.flatMap((g) => {
    const p = g.slotId === null ? undefined : ctx.position.get(g.slotId);
    return p ? [{ game: g, p }] : [];
  });
  let cost = roundCost(input, schedule);
  for (const team of input.teams)
    cost += teamCostAt(
      ctx,
      team.id,
      placed
        .filter((x) => x.game.teamA === team.id || x.game.teamB === team.id)
        .map((x) => x.p),
    );
  const occupied = new Set(placed.map((x) => x.p.slot.id));
  for (const slots of fieldDays(input).values())
    cost += fieldDayCost(ctx, slots, (id) => occupied.has(id));
  return cost;
}
