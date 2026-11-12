import { describe, expect, it } from "vitest";
import {
  costContext,
  fieldDayCost,
  roundCost,
  scheduleCost,
  teamCost,
} from "./cost";
import { gameKey, type Schedule, type SchedulerInput } from "./types";
import {
  NAIVE,
  slot,
  slotId,
  SUNDAYS,
  workedExample,
} from "./worked-example.fixture";

const [base] = workedExample();
const w = base.weights;

/** The worked example's slot for a week, field and time (0-based). */
const at = (week: number, field: number, time: number) => {
  const found = base.slots.find((s) => s.id === slotId(week, field, time));
  if (!found) throw new Error("No such slot");
  return found;
};

describe("teamCost", () => {
  const ctx = costContext(base);

  it("is zero for an even spread with no streaks", () => {
    // Times 0, 1, 2 and fields 1, 2, 1: spreads of 1, no penalty.
    expect(teamCost(ctx, "A", [at(0, 0, 0), at(1, 1, 1), at(2, 0, 2)])).toBe(0);
  });

  it("adds balance (S1, S2), streak (S3) and fine balance (S9)", () => {
    const sameSlot = [at(0, 0, 0), at(1, 0, 0), at(2, 0, 0)];
    // Times 3/0/0: spread 3, (3 − 1)² = 4. Fields 3/0: also 4.
    // Three weeks in a row at 10:00: one week beyond 2.
    // Fine balance: ideal 1 per time, so 2² + 1 + 1 = 6.
    expect(teamCost(ctx, "A", sameSlot)).toBe(
      4 * w.timeBalance + 4 * w.fieldBalance + w.streaks + 6 * w.fineBalance,
    );
  });

  it("counts idle slots between a team's two games on a day (S4)", () => {
    const ctx2 = costContext({ ...base, gamesPerTeamPerDay: 2 });
    const twoGames = [at(0, 0, 0), at(0, 0, 2), at(1, 1, 1), at(2, 1, 1)];
    const adjacent = [at(0, 0, 0), at(0, 0, 1), at(1, 1, 2), at(2, 1, 2)];
    expect(teamCost(ctx2, "A", twoGames) - teamCost(ctx2, "A", adjacent)).toBe(
      w.doubleheaderWait,
    );
  });

  it("prices preferences (S6)", () => {
    const games = [at(0, 0, 0), at(1, 1, 1), at(2, 0, 2)];
    const withPrefs = (constraints: SchedulerInput["constraints"]) =>
      teamCost(costContext({ ...base, constraints }), "A", games);
    expect(
      withPrefs([{ teamId: "A", kind: "prefer", timeIndex: 0, weight: 2 }]),
    ).toBe(2 * 2 * w.preferences);
    expect(withPrefs([{ teamId: "A", kind: "avoid", timeIndex: 0 }])).toBe(
      w.preferences,
    );
    expect(withPrefs([{ teamId: "A", kind: "avoid", date: SUNDAYS[0] }])).toBe(
      w.preferences,
    );
    expect(
      withPrefs([
        { teamId: "A", kind: "prefer", date: SUNDAYS[3] },
        { teamId: "A", kind: "prefer", date: SUNDAYS[1], timeIndex: 1 },
        { teamId: "A", kind: "prefer" },
        { teamId: "A", kind: "unavailable", date: SUNDAYS[0] },
        { teamId: "B", kind: "avoid", timeIndex: 0 },
      ]),
    ).toBe(w.preferences);
  });
});

describe("fieldDayCost (S5)", () => {
  const ctx = costContext(base);
  const field = [at(0, 0, 0), at(0, 0, 1), at(0, 0, 2)];

  it("counts empty slots between games on a field", () => {
    const used = (slots: { id: string }[]) => (id: string) =>
      slots.some((s) => s.id === id);
    expect(fieldDayCost(ctx, field, used([at(0, 0, 0), at(0, 0, 2)]))).toBe(
      w.idleFields,
    );
    expect(fieldDayCost(ctx, field, used([at(0, 0, 0), at(0, 0, 1)]))).toBe(0);
    expect(fieldDayCost(ctx, field, used([]))).toBe(0);
  });
});

describe("roundCost (S7, S8)", () => {
  const game = (round: number, a: string, b: string) => ({
    key: gameKey(round, a, b),
    round,
    teamA: a,
    teamB: b,
    slotId: null,
  });
  const schedule = (
    games: Schedule["games"],
    byes: Schedule["byes"] = [],
  ): Schedule => ({ games, byes, unplaced: [], diagnostics: [] });

  it("charges rematches closer than the target", () => {
    // Eight teams: target gap 6.
    expect(
      roundCost(base, schedule([game(1, "A", "B"), game(3, "A", "B")])),
    ).toBe(4 * w.rematchSpacing);
    expect(
      roundCost(base, schedule([game(1, "A", "B"), game(8, "A", "B")])),
    ).toBe(0);
  });

  it("charges byes in consecutive rounds", () => {
    const byes = [
      { round: 1, teamId: "A" },
      { round: 2, teamId: "A" },
      { round: 4, teamId: "A" },
    ];
    expect(roundCost(base, schedule([], byes))).toBe(w.backToBackByes);
  });
});

describe("scheduleCost", () => {
  it("is only fine balance for the worked example's optimized schedule", () => {
    // Every team plays 7 games as 2/2/3 over three times: (1/3)² × 2 + (2/3)².
    expect(scheduleCost(...workedExample())).toBeCloseTo(8 * (6 / 9), 9);
  });

  it("is far higher for the naive placement", () => {
    expect(scheduleCost(...workedExample({}, NAIVE))).toBeGreaterThan(10_000);
  });

  it("ignores unplaced games and playoff slots", () => {
    const [input, schedule] = workedExample();
    const playoff = {
      ...slot("final", "2027-06-01", "F9", 0),
      kind: "playoff" as const,
    };
    const extra = {
      key: "r14:A:B",
      round: 14,
      teamA: "A",
      teamB: "B",
      slotId: "final",
    };
    expect(
      scheduleCost(
        { ...input, slots: [...input.slots, playoff] },
        { ...schedule, games: [...schedule.games, extra] },
      ),
    ).toBeCloseTo(scheduleCost(input, schedule), 9);
  });
});
