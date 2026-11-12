import { measure, type Metrics } from "./measure";
import type { Schedule, ScheduledGame, SchedulerInput, Slot } from "./types";

export type ReschedulePolicy = {
  /** Makeups go on dates after this one. Default: the last cancelled date. */
  notBefore?: string;
  /** Most games a team may play on one date, makeups included. Default 2. */
  maxGamesPerDay?: number;
  /**
   * Largest search, in candidate placements, that is tried exhaustively;
   * beyond it games are placed greedily and then improved one at a time.
   */
  exhaustiveLimit?: number;
};

export type RescheduleResult = {
  schedule: Schedule;
  /** Pins after the rain-out: pins of postponed games are dropped. */
  locked: SchedulerInput["locked"];
  /** Where each postponed game went; `to` is null when it found no slot. */
  moved: { gameKey: string; from: string; to: string | null }[];
  metrics: Metrics;
};

/** Lexicographic: unplaced, then idle wait, then fairness overflow, then finish. */
type Score = [unplaced: number, wait: number, overflow: number, finish: number];

const better = (a: Score, b: Score) => {
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i]) return (a[i] as number) < (b[i] as number);
  return false;
};

/**
 * Places the games from cancelled slots while moving nothing else
 * (scheduling-algorithm.md, section 7). Candidates are empty, uncancelled
 * slots after the rain-out: reserve slots and designated rain dates. Every
 * hard rule for makeups holds (one game per slot, no team in two games at
 * once or on a date it cannot make, at most `maxGamesPerDay` games a day,
 * no pair twice in a day), and among those placements the best is chosen by
 * the order in the spec.
 */
export function reschedule(
  input: SchedulerInput,
  schedule: Schedule,
  cancelledSlotIds: readonly string[],
  policy: ReschedulePolicy = {},
): RescheduleResult {
  const maxPerDay = policy.maxGamesPerDay ?? 2;
  const limit = policy.exhaustiveLimit ?? 2_000_000;
  const cancelled = new Set(cancelledSlotIds);
  const slotsById = new Map(input.slots.map((s) => [s.id, s]));

  const postponed = schedule.games.filter(
    (g) => g.slotId !== null && cancelled.has(g.slotId),
  );
  const fixed = schedule.games.filter(
    (g) => g.slotId !== null && !cancelled.has(g.slotId),
  );
  const fixedSlots = new Set(fixed.map((g) => g.slotId));
  const lastCancelled = [...cancelled]
    .map((id) => slotsById.get(id)?.date ?? "")
    .sort()
    .at(-1);
  const notBefore = policy.notBefore ?? lastCancelled ?? "";
  const candidates = input.slots
    .filter(
      (s) =>
        s.kind !== "playoff" &&
        s.date > notBefore &&
        !cancelled.has(s.id) &&
        !fixedSlots.has(s.id),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.timeIndex - b.timeIndex ||
        a.fieldId.localeCompare(b.fieldId),
    );
  const dates = [...new Set(candidates.map((s) => s.date))];

  // Season counts from games that stay put, for fairness overflow.
  const timeIndexes = [
    ...new Set(
      input.slots.filter((s) => s.kind !== "playoff").map((s) => s.timeIndex),
    ),
  ].sort((a, b) => a - b);
  const fields = [
    ...new Set(
      input.slots.filter((s) => s.kind !== "playoff").map((s) => s.fieldId),
    ),
  ].sort();
  const fixedPlaced = fixed.flatMap((g) => {
    const slot = slotsById.get(g.slotId as string);
    return slot ? [{ game: g, slot }] : [];
  });
  const teamsOf = (g: ScheduledGame) => [g.teamA, g.teamB];
  const involved = [...new Set(postponed.flatMap(teamsOf))];
  const baseCounts = new Map(
    involved.map((team) => {
      const own = fixedPlaced.filter((p) => teamsOf(p.game).includes(team));
      return [
        team,
        {
          time: timeIndexes.map(
            (t) => own.filter((p) => p.slot.timeIndex === t).length,
          ),
          field: fields.map(
            (f) => own.filter((p) => p.slot.fieldId === f).length,
          ),
        },
      ];
    }),
  );

  const unavailable = input.constraints.filter((c) => c.kind === "unavailable");
  const canPlay = (team: string, slot: Slot) =>
    !unavailable.some(
      (c) =>
        c.teamId === team &&
        (c.date === undefined || c.date === slot.date) &&
        (c.timeIndex === undefined || c.timeIndex === slot.timeIndex),
    );

  // What each team already does on each date: time indexes and opponents.
  const dayOf = new Map<string, { times: number[]; opponents: string[] }>();
  const day = (team: string, date: string) => {
    const key = `${team}\u0000${date}`;
    let entry = dayOf.get(key);
    if (!entry) {
      entry = { times: [], opponents: [] };
      dayOf.set(key, entry);
    }
    return entry;
  };
  for (const { game, slot } of fixedPlaced) {
    day(game.teamA, slot.date).times.push(slot.timeIndex);
    day(game.teamA, slot.date).opponents.push(game.teamB);
    day(game.teamB, slot.date).times.push(slot.timeIndex);
    day(game.teamB, slot.date).opponents.push(game.teamA);
  }

  const fits = (game: ScheduledGame, slot: Slot) =>
    [
      [game.teamA, game.teamB],
      [game.teamB, game.teamA],
    ].every(([team, opponent]) => {
      const today = day(team as string, slot.date);
      return (
        canPlay(team as string, slot) &&
        !today.times.includes(slot.timeIndex) &&
        today.times.length < maxPerDay &&
        !today.opponents.includes(opponent as string)
      );
    });
  const take = (game: ScheduledGame, slot: Slot, by: 1 | -1) => {
    for (const [team, opponent] of [
      [game.teamA, game.teamB],
      [game.teamB, game.teamA],
    ] as const) {
      const today = day(team, slot.date);
      if (by === 1) {
        today.times.push(slot.timeIndex);
        today.opponents.push(opponent);
      } else {
        today.times.splice(today.times.indexOf(slot.timeIndex), 1);
        today.opponents.splice(today.opponents.indexOf(opponent), 1);
      }
    }
  };

  const choice: (Slot | null)[] = postponed.map(() => null);
  const used = new Set<string>();

  const score = (): Score => {
    let unplaced = 0;
    let wait = 0;
    let finish = -1;
    const waitDays = new Set<string>();
    choice.forEach((slot, i) => {
      if (!slot) {
        unplaced++;
        return;
      }
      finish = Math.max(finish, dates.indexOf(slot.date));
      for (const team of teamsOf(postponed[i] as ScheduledGame))
        waitDays.add(`${team}\u0000${slot.date}`);
    });
    for (const key of waitDays) {
      const times = [...(dayOf.get(key) as { times: number[] }).times].sort(
        (a, b) => a - b,
      );
      for (let t = 1; t < times.length; t++)
        wait += (times[t] as number) - (times[t - 1] as number) - 1;
    }
    let overflow = 0;
    for (const team of involved) {
      const counts = baseCounts.get(team) as {
        time: number[];
        field: number[];
      };
      const time = [...counts.time];
      const field = [...counts.field];
      choice.forEach((slot, i) => {
        if (!slot || !teamsOf(postponed[i] as ScheduledGame).includes(team))
          return;
        const t = timeIndexes.indexOf(slot.timeIndex);
        const f = fields.indexOf(slot.fieldId);
        time[t] = (time[t] as number) + 1;
        field[f] = (field[f] as number) + 1;
      });
      // Empty lists give max − min = −Infinity, which counts as no overflow.
      for (const c of [time, field])
        overflow += Math.max(0, Math.max(...c) - Math.min(...c) - 1);
    }
    return [unplaced, wait, overflow, finish];
  };

  let best: { score: Score; slots: (Slot | null)[] } = {
    score: [Infinity, Infinity, Infinity, Infinity],
    slots: choice.slice(),
  };
  const consider = () => {
    const s = score();
    if (better(s, best.score)) best = { score: s, slots: choice.slice() };
  };

  // Exhaustive depth-first search, pruned on the unplaced count.
  let size = 1;
  for (let i = 0; i < postponed.length; i++) size *= candidates.length + 1;
  if (size <= limit) {
    const visit = (i: number, unplaced: number) => {
      if (unplaced > best.score[0]) return;
      if (i === postponed.length) return consider();
      const game = postponed[i] as ScheduledGame;
      for (const slot of candidates) {
        if (used.has(slot.id) || !fits(game, slot)) continue;
        choice[i] = slot;
        used.add(slot.id);
        take(game, slot, 1);
        visit(i + 1, unplaced);
        take(game, slot, -1);
        used.delete(slot.id);
      }
      choice[i] = null;
      visit(i + 1, unplaced + 1);
    };
    visit(0, 0);
  } else {
    // Greedy: each game in turn takes the slot that scores best so far.
    postponed.forEach((game, i) => {
      let pick: Slot | null = null;
      let pickScore: Score | null = null;
      for (const slot of candidates) {
        if (used.has(slot.id) || !fits(game, slot)) continue;
        choice[i] = slot;
        take(game, slot, 1);
        const s = score();
        take(game, slot, -1);
        if (!pickScore || better(s, pickScore)) [pick, pickScore] = [slot, s];
      }
      choice[i] = pick;
      if (pick) {
        used.add(pick.id);
        take(game, pick, 1);
      }
    });
    // Then move one makeup at a time while that improves the score.
    let current = score();
    for (let improved = true; improved;) {
      improved = false;
      postponed.forEach((game, i) => {
        const from = choice[i] as Slot | null;
        if (from) {
          take(game, from, -1);
          used.delete(from.id);
        }
        for (const slot of [...candidates, null]) {
          if (slot && (used.has(slot.id) || !fits(game, slot))) continue;
          choice[i] = slot;
          if (slot) take(game, slot, 1);
          const s = score();
          if (slot) take(game, slot, -1);
          if (better(s, current)) {
            current = s;
            improved = true;
            break;
          }
          choice[i] = from;
        }
        const now = choice[i];
        if (now) {
          take(game, now, 1);
          used.add(now.id);
        }
      });
    }
    best = { score: current, slots: choice.slice() };
  }

  const placedAt = new Map(
    postponed.map((g, i) => [g.key, best.slots[i]?.id ?? null]),
  );
  const games = schedule.games.map((g) =>
    placedAt.has(g.key) ? { ...g, slotId: placedAt.get(g.key) ?? null } : g,
  );
  const unplaced = games.filter((g) => g.slotId === null).map((g) => g.key);
  const left = best.score[0];
  const diagnostics =
    left > 0
      ? [
          `${left} postponed game${left === 1 ? "" : "s"} could not be placed. Add a rain date, squeeze a date into shorter games, or accept the loss.`,
        ]
      : [];
  const next: Schedule = {
    ...schedule,
    games,
    unplaced,
    diagnostics: [...schedule.diagnostics, ...diagnostics],
  };
  const locked = input.locked.filter((l) => !placedAt.has(l.gameKey));
  return {
    schedule: next,
    locked,
    moved: postponed.map((g) => ({
      gameKey: g.key,
      from: g.slotId as string,
      to: placedAt.get(g.key) ?? null,
    })),
    // Cancelled slots are gone: not reserve, and not counted anywhere else.
    metrics: measure(
      {
        ...input,
        slots: input.slots.filter((s) => !cancelled.has(s.id)),
        locked,
      },
      next,
    ),
  };
}
