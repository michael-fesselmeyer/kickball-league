import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { measure } from "./measure";
import { gameKey, type Schedule, type SchedulerInput } from "./types";
import {
  move,
  NAIVE,
  slot,
  SUNDAYS,
  workedExample,
} from "./worked-example.fixture";

const game = (round: number, a: string, b: string, slotId: string | null) => ({
  key: gameKey(round, a, b),
  round,
  teamA: a,
  teamB: b,
  slotId,
});

const scheduleOf = (
  games: Schedule["games"],
  byes: Schedule["byes"] = [],
): Schedule => ({ games, byes, unplaced: [], diagnostics: [] });

describe("measure on the worked example (section 9)", () => {
  it("matches the naive column of the comparison table", () => {
    const m = measure(...workedExample({}, NAIVE));
    expect(m.timeSlotSpread).toMatchObject({
      value: 7,
      status: "poor",
      bestPossible: 1,
      teams: ["A"],
    });
    expect(m.fieldSpread).toMatchObject({ value: 7, bestPossible: 1 });
    expect(m.longestStreak).toEqual({ value: 7, status: "poor" });
    expect(m.gamesPerTimeIndex).toEqual([14, 14, 0]);
    expect(m.reserveRemaining.value).toBe(14);
    expect(m.teams.find((t) => t.teamId === "A")).toMatchObject({
      byTimeIndex: [7, 0, 0],
      byField: [7, 0],
    });
    for (const t of m.teams.filter((t) => t.teamId !== "A"))
      expect([t.byTimeIndex, t.byField]).toEqual([
        [3, 4, 0],
        [3, 4],
      ]);
  });

  it("matches the optimized column and the per-team table", () => {
    const m = measure(...workedExample());
    expect(m.timeSlotSpread).toMatchObject({
      value: 1,
      status: "good",
      bestPossible: 1,
    });
    expect(m.fieldSpread).toMatchObject({
      value: 1,
      status: "good",
      bestPossible: 1,
    });
    expect(m.longestStreak).toEqual({ value: 2, status: "good" });
    expect(m.gamesPerTimeIndex).toEqual([9, 10, 9]);
    expect(m.reserveRemaining).toMatchObject({ value: 14, status: "good" });
    expect(m.reserveRemaining.byDate).toEqual(
      SUNDAYS.map((date) => ({ date, empty: 2 })),
    );
    expect(
      Object.fromEntries(
        m.teams.map((t) => [
          t.teamId,
          `${t.byTimeIndex.join("/")} ${t.byField.join("/")}`,
        ]),
      ),
    ).toEqual({
      A: "2/3/2 3/4",
      B: "3/2/2 4/3",
      C: "2/3/2 3/4",
      D: "2/3/2 3/4",
      E: "2/2/3 4/3",
      F: "3/2/2 3/4",
      G: "2/2/3 3/4",
      H: "2/3/2 3/4",
    });
  });

  it("reports the earliest-slot share range", () => {
    expect(measure(...workedExample()).earliestSlotShare).toEqual({
      value: { highest: 3 / 7, lowest: 2 / 7 },
      status: "good",
    });
    expect(
      measure(...workedExample({}, NAIVE)).earliestSlotShare,
    ).toMatchObject({ value: { highest: 1, lowest: 3 / 7 }, status: "poor" });
  });

  it("has no byes, rematches, waits or preferences to report", () => {
    const m = measure(...workedExample());
    expect(m.byeBalance).toEqual({ value: 0, status: "good" });
    expect(m.rematchGap).toEqual({ value: null, status: "good", target: 6 });
    expect(m.doubleheaderWait).toEqual({ value: 0, status: "good" });
    expect(m.preferencesHonored).toEqual({ value: null, status: "good" });
    expect(m.unplaced).toEqual({ value: 0, status: "good" });
  });

  it("counts an unplaced game and the slot it frees", () => {
    const [input, schedule] = workedExample();
    expect(() => move(schedule, 1, "A-B", null)).toThrow("No game r1:A:B");
    const m = measure(input, move(schedule, 1, "A-H", null));
    expect(m.unplaced).toEqual({ value: 1, status: "poor" });
    expect(m.reserveRemaining.byDate[0]).toEqual({
      date: SUNDAYS[0],
      empty: 3,
    });
  });

  it("leaves playoff slots out of the regular-season metrics", () => {
    const [input, schedule] = workedExample();
    const playoff = {
      ...slot("final", "2027-05-23", "F9", 5),
      kind: "playoff" as const,
    };
    const m = measure(
      { ...input, slots: [...input.slots, playoff] },
      { ...schedule, games: [...schedule.games, game(8, "A", "B", "final")] },
    );
    expect(m.timeIndexes).toEqual([0, 1, 2]);
    expect(m.fields).toEqual(["F1", "F2"]);
    expect(m.timeSlotSpread.value).toBe(1);
  });
});

describe("measure on small cases", () => {
  const [base] = workedExample();
  const date = SUNDAYS[0];
  const day = [0, 1, 2].map((t) => slot(`s${t}`, date, "F1", t));

  it("adds up doubleheader waits", () => {
    const input: SchedulerInput = {
      ...base,
      teams: [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }],
      slots: day,
      gamesPerTeamPerDay: 2,
    };
    const m = measure(
      input,
      scheduleOf([game(1, "A", "B", "s0"), game(2, "A", "C", "s2")]),
    );
    expect(m.teams.find((t) => t.teamId === "A")?.doubleheaderWait).toBe(1);
    expect(m.doubleheaderWait).toEqual({ value: 1, status: "review" });
  });

  it("grades bye balance", () => {
    const input = { ...base, teams: [{ id: "A" }, { id: "B" }, { id: "C" }] };
    const byes = (...teams: string[]) =>
      teams.map((teamId, i) => ({ round: i + 1, teamId }));
    expect(
      measure(input, scheduleOf([], byes("A", "B", "C"))).byeBalance,
    ).toEqual({ value: 0, status: "good" });
    expect(measure(input, scheduleOf([], byes("A", "A"))).byeBalance).toEqual({
      value: 2,
      status: "poor",
    });
  });

  it("grades the rematch gap against the pool size", () => {
    const four = {
      ...base,
      teams: ["A", "B", "C", "D"].map((id) => ({ id })),
    };
    const meetings = (second: number) =>
      scheduleOf([game(1, "A", "B", null), game(second, "A", "B", null)]);
    expect(measure(four, meetings(4)).rematchGap).toEqual({
      value: 3,
      status: "good",
      target: 2,
    });
    expect(measure(four, meetings(2)).rematchGap).toMatchObject({
      value: 1,
      status: "review",
    });
    expect(measure(base, meetings(2)).rematchGap).toEqual({
      value: 1,
      status: "poor",
      target: 6,
    });
  });

  it("scores preferences per chance", () => {
    const [input, schedule] = workedExample({
      constraints: [
        // A plays 2 of 7 games at 10:00.
        { teamId: "A", kind: "prefer", timeIndex: 0 },
        // B plays in week 1, so this is missed.
        { teamId: "B", kind: "avoid", date: SUNDAYS[0] },
        // C plays in week 2: met.
        { teamId: "C", kind: "prefer", date: SUNDAYS[1] },
        // D never plays 1:00 in week 1 (D-E is at 11:30): met.
        { teamId: "D", kind: "avoid", date: SUNDAYS[0], timeIndex: 2 },
        // Ignored: not a preference, and a preference with no date or time.
        { teamId: "E", kind: "unavailable", date: SUNDAYS[3] },
        { teamId: "E", kind: "prefer" },
      ],
    });
    expect(measure(input, schedule).preferencesHonored).toEqual({
      value: 4 / 10,
      status: "poor",
    });
  });

  it("handles a league with no slots or games", () => {
    const m = measure({ ...base, slots: [] }, scheduleOf([]));
    expect(m.timeSlotSpread).toMatchObject({ value: 0, bestPossible: 0 });
    expect(m.earliestSlotShare.value).toEqual({ highest: 0, lowest: 0 });
    expect(m.reserveRemaining).toMatchObject({ value: 0, status: "poor" });
  });
});

describe("measure properties", () => {
  const [base] = workedExample();
  const team = fc.constantFrom(..."ABCDEFGH".split(""));
  const arbitrarySchedule = fc
    .array(
      fc.record({
        round: fc.integer({ min: 1, max: 9 }),
        a: team,
        b: team,
        slot: fc.option(fc.constantFrom(...base.slots.map((s) => s.id)), {
          nil: null,
        }),
      }),
      { maxLength: 40 },
    )
    .map((games) =>
      scheduleOf(
        games
          .filter((g) => g.a !== g.b)
          .map((g) => game(g.round, g.a, g.b, g.slot)),
      ),
    );

  it("counts every placed appearance once, and never beats the best possible spread", () => {
    fc.assert(
      fc.property(arbitrarySchedule, (schedule) => {
        const m = measure(base, schedule);
        expect(measure(base, schedule)).toEqual(m);
        const appearances = schedule.games.filter((g) => g.slotId).length * 2;
        const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
        expect(sum(m.teams.map((t) => sum(t.byTimeIndex)))).toBe(appearances);
        expect(sum(m.teams.map((t) => sum(t.byField)))).toBe(appearances);
        expect(m.timeSlotSpread.value).toBeGreaterThanOrEqual(
          m.timeSlotSpread.bestPossible,
        );
        expect(m.fieldSpread.value).toBeGreaterThanOrEqual(
          m.fieldSpread.bestPossible,
        );
      }),
      { numRuns: 500 },
    );
  });
});
