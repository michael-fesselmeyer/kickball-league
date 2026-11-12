import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generate } from "./generate";
import { arbitraryLeague, league } from "./league.fixture";
import { reschedule } from "./reschedule";
import { validate } from "./validate";
import { slot, slotId, SUNDAYS, workedExample } from "./worked-example.fixture";

/** Every slot in week 3 (0-based week 2) of the worked example. */
const weekThree = [0, 1].flatMap((field) =>
  [0, 1, 2].map((time) => slotId(2, field, time)),
);

describe("reschedule: the worked example's rain-out (section 9)", () => {
  const [input, schedule] = workedExample();
  const result = reschedule(input, schedule, weekThree);

  it("places all four postponed games and moves nothing else", () => {
    expect(result.moved.map((m) => m.gameKey).sort()).toEqual([
      "r3:A:F",
      "r3:B:C",
      "r3:D:H",
      "r3:E:G",
    ]);
    expect(result.moved.every((m) => m.to !== null)).toBe(true);
    const before = new Map(schedule.games.map((g) => [g.key, g.slotId]));
    for (const g of result.schedule.games)
      if (g.round !== 3) expect(g.slotId).toBe(before.get(g.key));
    expect(result.schedule.unplaced).toEqual([]);
  });

  it("matches the spec's outcome: one idle slot in total, field spread 1, done by week 7", () => {
    // The spec's makeups: week 4 H-D at 11:30 F1, week 5 B-C at 1:00 F1,
    // week 6 A-F at 11:30 F1, week 7 G-E at 11:30 F2.
    const at = new Map(result.moved.map((m) => [m.gameKey, m.to]));
    expect(at.get("r3:D:H")).toBe(slotId(3, 0, 1));
    expect(at.get("r3:B:C")).toBe(slotId(4, 0, 2));
    expect(at.get("r3:A:F")).toBe(slotId(5, 0, 1));
    expect(at.get("r3:E:G")).toBe(slotId(6, 1, 1));
    expect(result.metrics.doubleheaderWait.value).toBe(1);
    expect(result.metrics.fieldSpread.value).toBe(1);
    expect(result.metrics.timeSlotSpread).toMatchObject({
      value: 3,
      teams: ["D", "H"],
    });
  });

  it("keeps the rest of the reserve: 4 empty slots in weeks 4 to 7", () => {
    const later = result.metrics.reserveRemaining.byDate.filter(
      (d) => d.date > (SUNDAYS[2] as string),
    );
    expect(later.reduce((sum, d) => sum + d.empty, 0)).toBe(4);
  });

  it("is valid apart from the postponed games' doubleheaders", () => {
    // Makeups make a second game on the day, which H6 allows up to 2.
    const withMakeupSlots = {
      ...input,
      gamesPerTeamPerDay: 2 as const,
      reservePerDay: 0,
    };
    expect(validate(withMakeupSlots, result.schedule)).toEqual([]);
  });
});

describe("reschedule: limits", () => {
  const [input, schedule] = workedExample();

  it("drops pins of postponed games", () => {
    const locked = [
      { gameKey: "r3:A:F", slotId: slotId(2, 0, 1) },
      { gameKey: "r1:A:H", slotId: slotId(0, 1, 1) },
    ];
    const result = reschedule({ ...input, locked }, schedule, weekThree);
    expect(result.locked).toEqual([locked[1]]);
  });

  it("reports games it cannot place, with what to do", () => {
    // Rain in the last week: no dates left.
    const lastWeek = [0, 1].flatMap((f) =>
      [0, 1, 2].map((t) => slotId(6, f, t)),
    );
    const result = reschedule(input, schedule, lastWeek);
    expect(result.moved.every((m) => m.to === null)).toBe(true);
    expect(result.schedule.diagnostics).toEqual([
      "4 postponed games could not be placed. Add a rain date, squeeze a date into shorter games, or accept the loss.",
    ]);
    expect(result.schedule.unplaced).toHaveLength(4);
  });

  it("uses a designated rain date, and honours maxGamesPerDay and notBefore", () => {
    const rainDate = "2027-05-23";
    const rainSlots = [0, 1, 2].flatMap((t) =>
      [1, 2].map((f) => ({
        ...slot(`rain/F${f}/${t}`, rainDate, `F${f}`, t),
        kind: "makeup_reserve" as const,
      })),
    );
    const withRain = { ...input, slots: [...input.slots, ...rainSlots] };
    // One game a day: makeups cannot share a date with a team's game.
    const result = reschedule(withRain, schedule, weekThree, {
      maxGamesPerDay: 1,
    });
    expect(result.moved.every((m) => m.to?.startsWith("rain/"))).toBe(true);
    const late = reschedule(withRain, schedule, weekThree, {
      notBefore: rainDate,
    });
    expect(late.moved.every((m) => m.to === null)).toBe(true);
  });

  it("singular message for one game left over", () => {
    const oneGame = [slotId(6, 0, 0)];
    const result = reschedule(input, schedule, oneGame);
    expect(result.schedule.diagnostics).toEqual([
      "1 postponed game could not be placed. Add a rain date, squeeze a date into shorter games, or accept the loss.",
    ]);
  });

  it("reaches the same outcome greedily on this example", () => {
    const greedy = reschedule(input, schedule, weekThree, {
      exhaustiveLimit: 0,
    });
    expect(greedy.moved.every((m) => m.to !== null)).toBe(true);
    expect(greedy.metrics.doubleheaderWait.value).toBe(1);
  });
});

describe("reschedule properties", () => {
  it(
    "P12: only postponed games move, and each appears exactly once",
    { timeout: 30_000 },
    () => {
      fc.assert(
        fc.property(arbitraryLeague(), fc.nat(), (input, pick) => {
          const schedule = generate(input, { iterations: 500 });
          const dates = [...new Set(input.slots.map((s) => s.date))].sort();
          const rained = dates[pick % dates.length] as string;
          const cancelled = input.slots
            .filter((s) => s.date === rained)
            .map((s) => s.id);
          const result = reschedule(input, schedule, cancelled, {
            exhaustiveLimit: 20_000,
          });
          const before = new Map(schedule.games.map((g) => [g.key, g.slotId]));
          const postponed = new Set(result.moved.map((m) => m.gameKey));
          for (const g of result.schedule.games)
            if (!postponed.has(g.key)) expect(g.slotId).toBe(before.get(g.key));
          expect(result.schedule.games).toHaveLength(schedule.games.length);
          // No slot holds two games, and no makeup lands on a cancelled slot.
          const used = result.schedule.games.flatMap((g) => g.slotId ?? []);
          expect(new Set(used).size).toBe(used.length);
          for (const m of result.moved)
            expect(cancelled.includes(m.to ?? "")).toBe(false);
          const h2 = validate(
            { ...input, gamesPerTeamPerDay: 2, reservePerDay: 0 },
            result.schedule,
          ).filter((v) => ["H1", "H2", "H4", "H8"].includes(v.rule));
          expect(h2).toEqual([]);
        }),
        { numRuns: 60 },
      );
    },
  );
});

describe("reschedule edge cases", () => {
  const [input, schedule] = workedExample();

  it("changes nothing when nothing is cancelled, and ignores unknown slots", () => {
    for (const cancelled of [[], ["no-such-slot"]]) {
      const result = reschedule(input, schedule, cancelled);
      expect(result.moved).toEqual([]);
      expect(result.schedule.games).toEqual(schedule.games);
    }
  });

  it("leaves alone a game whose slot does not exist", () => {
    const broken = {
      ...schedule,
      games: schedule.games.map((g) =>
        g.key === "r7:A:B" ? { ...g, slotId: "gone" } : g,
      ),
    };
    const result = reschedule(input, broken, weekThree);
    expect(result.schedule.games.find((g) => g.key === "r7:A:B")?.slotId).toBe(
      "gone",
    );
    expect(result.moved.every((m) => m.to !== null)).toBe(true);
  });

  it("greedy: reports games it cannot place", () => {
    const lastWeek = [0, 1].flatMap((f) =>
      [0, 1, 2].map((t) => slotId(6, f, t)),
    );
    const result = reschedule(input, schedule, lastWeek, {
      exhaustiveLimit: 0,
    });
    expect(result.moved.every((m) => m.to === null)).toBe(true);
  });

  it("greedy: improves its first choices one game at a time", () => {
    // Found by search: greedy's first placement here can be improved by
    // moving one makeup, which exercises the improvement pass.
    const shape = {
      teams: 5,
      fields: 2,
      times: 4,
      dates: 6,
      gamesPerTeamPerDay: 2 as const,
      reservePerDay: 1,
      seed: 1,
    };
    const leagueInput = league(shape);
    const season = generate(leagueInput, { iterations: 300 });
    const rained = leagueInput.slots
      .filter((s) => s.date === "2027-06-01")
      .map((s) => s.id);
    const greedy = reschedule(leagueInput, season, rained, {
      exhaustiveLimit: 0,
    });
    // Only postponed games moved, each is placed once at most, and the
    // makeups break none of the rules a makeup must keep.
    const before = new Map(season.games.map((g) => [g.key, g.slotId]));
    const postponed = new Set(greedy.moved.map((m) => m.gameKey));
    for (const g of greedy.schedule.games)
      if (!postponed.has(g.key)) expect(g.slotId).toBe(before.get(g.key));
    expect(
      validate(
        { ...leagueInput, gamesPerTeamPerDay: 2, reservePerDay: 0 },
        greedy.schedule,
      ).filter((v) => ["H1", "H2", "H4", "H8"].includes(v.rule)),
    ).toEqual([]);
  });
});
