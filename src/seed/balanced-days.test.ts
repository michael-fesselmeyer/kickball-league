import { describe, expect, it } from "vitest";
import { balancedGameDays } from "./balanced-days";
import { generateSeed, roundRobin } from "./generate";

const spread = (counts: number[]) => Math.max(...counts) - Math.min(...counts);

describe("balancedGameDays", () => {
  const rounds = roundRobin(8);
  const plan = balancedGameDays(rounds, { teams: 8, times: 2, fields: 3 });

  it("places every game of every round once, two at each kickoff", () => {
    expect(plan.map((day) => day.length)).toEqual(rounds.map((r) => r.length));
    for (const day of plan) {
      const keys = day.map((p) => `${p.timeIndex}/${p.field}`);
      expect(new Set(keys).size).toBe(day.length);
      expect(day.filter((p) => p.timeIndex === 0)).toHaveLength(2);
    }
  });

  it("evens out each team's kickoffs and fields, with no long same-slot runs", () => {
    for (let team = 0; team < 8; team++) {
      const mine = rounds.flatMap((pairs, r) =>
        pairs.flatMap(([a, b], i) =>
          a === team || b === team ? [plan[r]?.[i]] : [],
        ),
      );
      const times = [0, 1].map(
        (t) => mine.filter((p) => p?.timeIndex === t).length,
      );
      const fields = [0, 1, 2].map(
        (f) => mine.filter((p) => p?.field === f).length,
      );
      expect(spread(times)).toBeLessThanOrEqual(1);
      expect(spread(fields)).toBeLessThanOrEqual(1);
      const run = mine.reduce(
        (acc, p, i) =>
          i > 0 && p?.timeIndex === mine[i - 1]?.timeIndex
            ? { now: acc.now + 1, longest: Math.max(acc.longest, acc.now + 1) }
            : { now: 1, longest: Math.max(acc.longest, 1) },
        { now: 0, longest: 0 },
      );
      expect(run.longest).toBeLessThanOrEqual(2);
    }
  });

  it("is what the seed's fall season is placed by", () => {
    const data = generateSeed();
    const slotOf = new Map(data.slots.map((s) => [s.id, s]));
    for (const team of data.teamSeasons) {
      const own = data.games
        .filter((g) => g.teamAId === team.id || g.teamBId === team.id)
        .map((g) => slotOf.get(g.slotId));
      const fields = data.fields.map(
        (f) => own.filter((s) => s?.fieldId === f.id).length,
      );
      expect(spread(fields)).toBeLessThanOrEqual(1);
    }
  });
});
