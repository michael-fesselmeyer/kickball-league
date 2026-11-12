import type { Schedule, ScheduledGame, SchedulerInput, Slot } from "./types";

/** How a metric reads on the schedule screen. */
export type Status = "good" | "review" | "poor";

export type Metric<T = number> = { value: T; status: Status };

/** A spread, with the smallest value any schedule could reach. */
export type Spread = Metric & {
  bestPossible: number;
  /** Teams at the worst value, so the screen can name them. */
  teams: string[];
};

export type TeamMetrics = {
  teamId: string;
  games: number;
  /** Games at each time index, in the order of `Metrics.timeIndexes`. */
  byTimeIndex: number[];
  /** Games on each field, in the order of `Metrics.fields`. */
  byField: number[];
  timeSpread: number;
  fieldSpread: number;
  longestStreak: number;
  /** Share of games in the day's first slot, 0 to 1. */
  earliestShare: number;
  doubleheaderWait: number;
  byes: number;
};

export type Metrics = {
  timeIndexes: number[];
  fields: string[];
  timeSlotSpread: Spread;
  fieldSpread: Spread;
  longestStreak: Metric;
  earliestSlotShare: Metric<{ highest: number; lowest: number }>;
  doubleheaderWait: Metric;
  byeBalance: Metric;
  /** Fewest rounds between a pair's meetings; null with no rematches. */
  rematchGap: Metric<number | null> & { target: number };
  /** Share of prefer and avoid constraints met; null with none. */
  preferencesHonored: Metric<number | null>;
  unplaced: Metric;
  reserveRemaining: Metric & { byDate: { date: string; empty: number }[] };
  /** League-wide games at each time index. */
  gamesPerTimeIndex: number[];
  teams: TeamMetrics[];
};

type Placed = { game: ScheduledGame; slot: Slot };

const spreadOf = (counts: number[]) =>
  counts.length === 0 ? 0 : Math.max(...counts) - Math.min(...counts);

/** Lowest-is-best thresholds: good at or below `good`, review at or below `review`. */
const grade = (value: number, good: number, review: number): Status =>
  value <= good ? "good" : value <= review ? "review" : "poor";

const sortedUnique = <T>(items: T[], compare: (a: T, b: T) => number) =>
  [...new Set(items)].sort(compare);

/**
 * The fairness metrics in scheduling-algorithm.md, section 3, with the status
 * thresholds the schedule screen colors them by. Playoff slots are left out:
 * these describe the regular season.
 */
export function measure(input: SchedulerInput, schedule: Schedule): Metrics {
  const seasonSlots = input.slots.filter((s) => s.kind !== "playoff");
  const slotsById = new Map(seasonSlots.map((s) => [s.id, s]));
  const placed: Placed[] = [];
  for (const game of schedule.games) {
    const slot = game.slotId === null ? undefined : slotsById.get(game.slotId);
    if (slot) placed.push({ game, slot });
  }

  const timeIndexes = sortedUnique(
    seasonSlots.map((s) => s.timeIndex),
    (a, b) => a - b,
  );
  const fields = sortedUnique(
    seasonSlots.map((s) => s.fieldId),
    (a, b) => a.localeCompare(b),
  );

  const teams = input.teams.map((team) =>
    teamMetrics(team.id, placed, schedule, timeIndexes, fields),
  );
  const playing = teams.filter((t) => t.games > 0);

  const spread = (of: (t: TeamMetrics) => number, buckets: number): Spread => {
    const value = Math.max(0, ...teams.map(of));
    const bestPossible = Math.max(
      0,
      ...playing.map((t) => (buckets > 0 && t.games % buckets !== 0 ? 1 : 0)),
    );
    return {
      value,
      status: grade(value, 1, 2),
      bestPossible,
      teams:
        value > 0
          ? teams.filter((t) => of(t) === value).map((t) => t.teamId)
          : [],
    };
  };

  const longest = Math.max(0, ...teams.map((t) => t.longestStreak));
  const shares = playing.map((t) => t.earliestShare);
  const highest = shares.length ? Math.max(...shares) : 0;
  const lowest = shares.length ? Math.min(...shares) : 0;
  const wait = teams.reduce((sum, t) => sum + t.doubleheaderWait, 0);
  const byeSpread = spreadOf(teams.map((t) => t.byes));
  const unplaced = schedule.games.filter((g) => g.slotId === null).length;

  const byDate = [...Map.groupBy(seasonSlots, (s) => s.date)]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, slots]) => ({
      date,
      empty: slots.filter((s) => !placed.some((p) => p.slot.id === s.id))
        .length,
    }));
  const reserve = byDate.reduce((sum, d) => sum + d.empty, 0);
  const gameDay = Math.floor(input.teams.length / 2) * input.gamesPerTeamPerDay;

  return {
    timeIndexes,
    fields,
    timeSlotSpread: spread((t) => t.timeSpread, timeIndexes.length),
    fieldSpread: spread((t) => t.fieldSpread, fields.length),
    longestStreak: { value: longest, status: grade(longest, 2, 3) },
    earliestSlotShare: {
      value: { highest, lowest },
      status: grade(Math.round((highest - lowest) * 100), 15, 30),
    },
    doubleheaderWait: {
      value: wait,
      status:
        wait === 0 ? "good" : wait <= input.teams.length ? "review" : "poor",
    },
    byeBalance: {
      value: byeSpread,
      status: byeSpread <= 1 ? "good" : "poor",
    },
    rematchGap: rematchGap(input, schedule),
    preferencesHonored: preferencesHonored(input, placed),
    unplaced: { value: unplaced, status: unplaced === 0 ? "good" : "poor" },
    reserveRemaining: {
      value: reserve,
      status: reserve >= gameDay ? "good" : reserve > 0 ? "review" : "poor",
      byDate,
    },
    gamesPerTimeIndex: timeIndexes.map(
      (t) => placed.filter((p) => p.slot.timeIndex === t).length,
    ),
    teams,
  };
}

function teamMetrics(
  teamId: string,
  placed: Placed[],
  schedule: Schedule,
  timeIndexes: number[],
  fields: string[],
): TeamMetrics {
  const own = placed.filter(
    (p) => p.game.teamA === teamId || p.game.teamB === teamId,
  );
  const byTimeIndex = timeIndexes.map(
    (t) => own.filter((p) => p.slot.timeIndex === t).length,
  );
  const byField = fields.map(
    (f) => own.filter((p) => p.slot.fieldId === f).length,
  );

  // Game days in order, each with the time indexes played that day.
  const days = [...Map.groupBy(own, (p) => p.slot.date)]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, games]) =>
      games.map((p) => p.slot.timeIndex).sort((a, b) => a - b),
    );

  let longestStreak = 0;
  for (const t of timeIndexes) {
    let run = 0;
    for (const day of days) {
      run = day.includes(t) ? run + 1 : 0;
      longestStreak = Math.max(longestStreak, run);
    }
  }

  let doubleheaderWait = 0;
  for (const day of days)
    for (let i = 1; i < day.length; i++)
      // Two games at one time (a broken schedule) is no wait, not a negative one.
      doubleheaderWait += Math.max(
        0,
        (day[i] as number) - (day[i - 1] as number) - 1,
      );

  const first = timeIndexes[0];
  return {
    teamId,
    games: own.length,
    byTimeIndex,
    byField,
    timeSpread: spreadOf(byTimeIndex),
    fieldSpread: spreadOf(byField),
    longestStreak,
    earliestShare:
      own.length === 0
        ? 0
        : own.filter((p) => p.slot.timeIndex === first).length / own.length,
    doubleheaderWait,
    byes: schedule.byes.filter((b) => b.teamId === teamId).length,
  };
}

/** Fewest rounds between any pair's meetings, against the pool's target. */
function rematchGap(
  input: SchedulerInput,
  schedule: Schedule,
): Metrics["rematchGap"] {
  const poolSize = new Map<string, number>();
  for (const pool of Map.groupBy(
    input.teams,
    (t) => t.divisionId ?? "",
  ).values())
    for (const team of pool) poolSize.set(team.id, pool.length);

  const meetings = Map.groupBy(schedule.games, (g) =>
    [g.teamA, g.teamB].sort().join("\u0000"),
  );
  let gap: number | null = null;
  let target = Math.max(0, input.teams.length - 2);
  for (const games of meetings.values()) {
    const rounds = games.map((g) => g.round).sort((a, b) => a - b);
    for (let i = 1; i < rounds.length; i++) {
      const between = (rounds[i] as number) - (rounds[i - 1] as number);
      if (gap === null || between < gap) {
        gap = between;
        const [game] = games;
        target = Math.max(
          0,
          (poolSize.get((game as ScheduledGame).teamA) as number) - 2,
        );
      }
    }
  }
  const status: Status =
    gap === null || gap >= target
      ? "good"
      : gap >= target / 2
        ? "review"
        : "poor";
  return { value: gap, status, target };
}

/**
 * Share of soft preferences met. A `prefer` with a time index is one chance
 * per game it applies to; a `prefer` for a date alone is met by playing that
 * date. An `avoid` with a time index is one chance per game it applies to;
 * an `avoid` for a date alone is met by not playing that date.
 */
function preferencesHonored(
  input: SchedulerInput,
  placed: Placed[],
): Metrics["preferencesHonored"] {
  let chances = 0;
  let met = 0;
  for (const c of input.constraints) {
    if (c.kind === "unavailable") continue;
    const games = placed.filter(
      (p) =>
        (p.game.teamA === c.teamId || p.game.teamB === c.teamId) &&
        (c.date === undefined || p.slot.date === c.date),
    );
    if (c.timeIndex === undefined) {
      if (c.date === undefined) continue;
      chances += 1;
      met += (c.kind === "prefer") === games.length > 0 ? 1 : 0;
    } else {
      chances += games.length;
      met += games.filter(
        (p) => (p.slot.timeIndex === c.timeIndex) === (c.kind === "prefer"),
      ).length;
    }
  }
  if (chances === 0) return { value: null, status: "good" };
  const value = met / chances;
  return {
    value,
    status: value >= 0.8 ? "good" : value >= 0.5 ? "review" : "poor",
  };
}
