import { minCostAssignment } from "./assignment";
import type { Round, RoundDays } from "./rounds";
import {
  gameKey,
  type Schedule,
  type ScheduledGame,
  type SchedulerInput,
  type Slot,
} from "./types";

/** Finite, so a game can always fall back to "unplaced" instead of failing the day. */
const UNPLACED_COST = 1e9;

type Counts = {
  time: Map<string, number>;
  field: Map<string, number>;
  lastTimeIndex: Map<string, number>;
};

const bump = (map: Map<string, number>, key: string) =>
  map.set(key, (map.get(key) ?? 0) + 1);

/**
 * How much putting a game in a slot would worsen the season so far
 * (scheduling-algorithm.md, Stage C1). Infinity when a team is unavailable.
 */
export function placementCost(
  teams: readonly [string, string],
  slot: Slot,
  counts: Counts,
  input: Pick<SchedulerInput, "constraints" | "weights">,
): number {
  const w = input.weights;
  let cost = 0;
  for (const team of teams) {
    for (const c of input.constraints) {
      if (c.teamId !== team) continue;
      const onDate = c.date === undefined || c.date === slot.date;
      const atTime =
        c.timeIndex === undefined || c.timeIndex === slot.timeIndex;
      if (c.kind === "unavailable" && onDate && atTime) return Infinity;
      if (c.timeIndex === undefined || !onDate) continue;
      const missed =
        c.kind === "prefer" ? !atTime : c.kind === "avoid" && atTime;
      if (missed) cost += w.preferences * (c.weight ?? 1);
    }
    cost += w.timeBalance * (counts.time.get(`${team}@${slot.timeIndex}`) ?? 0);
    cost += w.fieldBalance * (counts.field.get(`${team}@${slot.fieldId}`) ?? 0);
    if (counts.lastTimeIndex.get(team) === slot.timeIndex) cost += w.streaks;
  }
  return cost;
}

/**
 * Stage C1: a good first placement. Days are processed in order; each
 * round's games get that day's free regular slots by a minimum-cost
 * assignment. A doubleheader day places its rounds one after the other, with
 * a slot priced at Infinity when a team already plays at that time (H2).
 * Locked games go into their slots first. A game no slot can take is listed
 * in `unplaced` with a reason; slots left empty are the day's reserve.
 */
export function constructPlacement(
  rounds: readonly Round[],
  days: RoundDays["days"],
  input: SchedulerInput,
): Schedule {
  const games: ScheduledGame[] = rounds.flatMap((r) =>
    r.games.map(([teamA, teamB]) => ({
      key: gameKey(r.round, teamA, teamB),
      round: r.round,
      teamA,
      teamB,
      slotId: null,
    })),
  );
  const byes = rounds.flatMap((r) =>
    r.bye === null ? [] : [{ round: r.round, teamId: r.bye }],
  );
  const diagnostics: string[] = [];
  const slotsById = new Map(input.slots.map((s) => [s.id, s]));
  const used = new Set<string>();
  const counts: Counts = {
    time: new Map(),
    field: new Map(),
    lastTimeIndex: new Map(),
  };
  const busy = new Set<string>(); // `${team}@${date}@${timeIndex}`

  const place = (game: ScheduledGame, slot: Slot) => {
    game.slotId = slot.id;
    used.add(slot.id);
    for (const team of [game.teamA, game.teamB]) {
      bump(counts.time, `${team}@${slot.timeIndex}`);
      bump(counts.field, `${team}@${slot.fieldId}`);
      busy.add(`${team}@${slot.date}@${slot.timeIndex}`);
    }
  };

  const byKey = new Map(games.map((g) => [g.key, g]));
  for (const lock of input.locked) {
    const game = byKey.get(lock.gameKey);
    const slot = slotsById.get(lock.slotId);
    if (game && slot && !used.has(slot.id)) place(game, slot);
  }

  for (const day of days) {
    const daySlots = input.slots
      .filter((s) => s.date === day.date && s.kind === "regular")
      .sort(
        (a, b) =>
          a.timeIndex - b.timeIndex || a.fieldId.localeCompare(b.fieldId),
      );
    for (const round of day.rounds) {
      const pending = games.filter(
        (g) => g.round === round && g.slotId === null,
      );
      const free = daySlots.filter((s) => !used.has(s.id));
      if (pending.length === 0) continue;
      // One column per free slot, then one "unplaced" column per game.
      const cost = pending.map((g, i) => [
        ...free.map((slot) =>
          busy.has(`${g.teamA}@${slot.date}@${slot.timeIndex}`) ||
          busy.has(`${g.teamB}@${slot.date}@${slot.timeIndex}`)
            ? Infinity
            : placementCost([g.teamA, g.teamB], slot, counts, input),
        ),
        ...pending.map((_, j) => (i === j ? UNPLACED_COST : Infinity)),
      ]);
      const columns = minCostAssignment(cost) as number[];
      pending.forEach((game, i) => {
        const slot = free[columns[i] as number];
        if (slot) place(game, slot);
        else
          diagnostics.push(
            `Game ${game.key} could not be placed on ${day.date}: no free slot suits both teams.`,
          );
      });
    }
    // The streak cost compares with a team's time on its latest game day.
    const today = new Map<string, number>();
    for (const g of games) {
      const slot = g.slotId === null ? undefined : slotsById.get(g.slotId);
      if (slot?.date !== day.date) continue;
      for (const team of [g.teamA, g.teamB])
        today.set(team, Math.max(today.get(team) ?? -1, slot.timeIndex));
    }
    for (const [team, timeIndex] of today)
      counts.lastTimeIndex.set(team, timeIndex);
  }

  return {
    games,
    byes,
    unplaced: games.filter((g) => g.slotId === null).map((g) => g.key),
    diagnostics,
  };
}
