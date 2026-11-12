/**
 * Properties that relate one generated season to another
 * (scheduling-algorithm.md, section 11): P8, P10 and P11. The exact best
 * schedule is unknown, so these check how outputs must relate when inputs
 * are related.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generate } from "./generate";
import { arbitraryLeague, league } from "./league.fixture";
import { measure } from "./measure";
import type { Schedule, SchedulerInput } from "./types";
import { validate } from "./validate";
import { slot, workedExample } from "./worked-example.fixture";

const options = { iterations: 1_500 };

const feasible = (input: SchedulerInput, schedule: Schedule) =>
  schedule.unplaced.length === 0 && validate(input, schedule).length === 0;

describe("scheduler properties", () => {
  it(
    "P8: pinned games keep their slots when the season is generated again",
    { timeout: 30_000 },
    () => {
      fc.assert(
        fc.property(
          arbitraryLeague(),
          fc.array(fc.nat(), { maxLength: 6 }),
          (input, picks) => {
            const first = generate(input, options);
            const placed = first.games.filter((g) => g.slotId !== null);
            fc.pre(placed.length > 0);
            const locked = [
              ...new Map(
                picks.map((p) => {
                  const g = placed[
                    p % placed.length
                  ] as (typeof placed)[number];
                  return [
                    g.key,
                    { gameKey: g.key, slotId: g.slotId as string },
                  ];
                }),
              ).values(),
            ];
            const pinned = { ...input, locked };
            const again = generate(pinned, options);
            for (const lock of locked)
              expect(
                again.games.find((g) => g.key === lock.gameKey)?.slotId,
              ).toBe(lock.slotId);
            expect(validate(pinned, again)).toEqual([]);
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    "P10: an extra empty slot never makes a feasible season infeasible",
    { timeout: 30_000 },
    () => {
      fc.assert(
        fc.property(arbitraryLeague(), fc.nat(), fc.nat(), (input, d, t) => {
          fc.pre(feasible(input, generate(input, options)));
          const dates = [...new Set(input.slots.map((s) => s.date))];
          const times = [...new Set(input.slots.map((s) => s.timeIndex))];
          const date = dates[d % dates.length] as string;
          const time = times[t % times.length] as number;
          const roomier = {
            ...input,
            slots: [
              ...input.slots,
              slot(`${date}/extra`, date, "Fextra", time),
            ],
          };
          expect(feasible(roomier, generate(roomier, options))).toBe(true);
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    "P11: renaming teams keeps the season valid and about as fair",
    { timeout: 30_000 },
    () => {
      fc.assert(
        fc.property(
          arbitraryLeague(),
          fc.integer({ min: 1, max: 1_000 }),
          (input, shift) => {
            const ids = input.teams.map((t) => t.id);
            const rename = new Map(
              ids.map((id, i) => [id, `X${(i + shift) % ids.length}`]),
            );
            const renamed: SchedulerInput = {
              ...input,
              teams: input.teams.map((t) => ({
                ...t,
                id: rename.get(t.id) as string,
              })),
              constraints: input.constraints.map((c) => ({
                ...c,
                teamId: rename.get(c.teamId) as string,
              })),
            };
            const original = generate(input, options);
            const relabelled = generate(renamed, options);
            expect(validate(renamed, relabelled)).toEqual([]);
            expect(relabelled.unplaced.length).toBe(original.unplaced.length);
            const [a, b] = [
              measure(input, original),
              measure(renamed, relabelled),
            ];
            expect(
              Math.abs(a.timeSlotSpread.value - b.timeSlotSpread.value),
            ).toBeLessThanOrEqual(1);
            expect(
              Math.abs(a.fieldSpread.value - b.fieldSpread.value),
            ).toBeLessThanOrEqual(1);
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});

describe("the worked example", () => {
  it("generates the same season as before (change the snapshot deliberately)", () => {
    const [input] = workedExample();
    const schedule = generate(input);
    const m = measure(input, schedule);
    expect({
      games: schedule.games.map((g) => `${g.key}@${g.slotId}`),
      spreads: [m.timeSlotSpread.value, m.fieldSpread.value],
      longestStreak: m.longestStreak.value,
    }).toMatchSnapshot();
  });
});

describe("regressions found by these properties", () => {
  it("P10: an extra 10:00 slot no longer strands a team that cannot play at 10:00", () => {
    // One field, three times; T0 can never play the first time. The extra
    // slot made the first date a doubleheader no placement could fit.
    const input = {
      ...league({
        teams: 4,
        fields: 1,
        times: 3,
        dates: 4,
        gamesPerTeamPerDay: 2,
        reservePerDay: 0,
        rounds: 4,
        seed: 0,
      }),
      constraints: [
        { teamId: "T0", kind: "unavailable" as const, timeIndex: 0 },
      ],
    };
    const roomier = {
      ...input,
      slots: [
        ...input.slots,
        slot("2027-06-01/extra", "2027-06-01", "Fextra", 0),
      ],
    };
    for (const each of [input, roomier]) {
      const schedule = generate(each, options);
      expect(schedule.unplaced).toEqual([]);
      expect(validate(each, schedule)).toEqual([]);
    }
  });

  it("P10: a doubleheader day splits its times between rounds when it must", () => {
    const input = {
      ...league({
        teams: 4,
        fields: 3,
        times: 3,
        dates: 4,
        gamesPerTeamPerDay: 2,
        reservePerDay: 0,
        rounds: 4,
        seed: 0,
      }),
      constraints: [
        {
          teamId: "T0",
          kind: "unavailable" as const,
          date: "2027-06-02",
          timeIndex: 0,
        },
      ],
    };
    const roomier = {
      ...input,
      slots: [
        ...input.slots,
        slot("2027-06-02/extra", "2027-06-02", "Fextra", 2),
      ],
    };
    const schedule = generate(roomier, options);
    expect(schedule.unplaced).toEqual([]);
    expect(validate(roomier, schedule)).toEqual([]);
  });

  it("P10: two rounds can share a time on a tight doubleheader day", () => {
    // Seven teams, two fields, three times: a round needs two of the times.
    // The extra slot moved rounds 1 and 2 onto a date where T1 cannot play
    // the middle time, and no split of the times between rounds fits.
    const input = {
      ...league({
        teams: 7,
        fields: 2,
        times: 3,
        dates: 4,
        gamesPerTeamPerDay: 2,
        reservePerDay: 0,
        rounds: 7,
        seed: 0,
      }),
      constraints: [
        {
          teamId: "T1",
          kind: "unavailable" as const,
          date: "2027-06-01",
          timeIndex: 1,
        },
        {
          teamId: "T0",
          kind: "unavailable" as const,
          date: "2027-06-04",
          timeIndex: 0,
        },
      ],
    };
    const roomier = {
      ...input,
      slots: [
        ...input.slots,
        slot("2027-06-03/extra", "2027-06-03", "Fextra", 0),
      ],
    };
    for (const each of [input, roomier]) {
      const schedule = generate(each, options);
      expect(schedule.unplaced).toEqual([]);
      expect(validate(each, schedule)).toEqual([]);
    }
  });

  it("P8: regenerating around pins rebuilds the same days for pinned rounds", () => {
    const input = league({
      teams: 6,
      fields: 2,
      times: 3,
      dates: 4,
      gamesPerTeamPerDay: 2,
      reservePerDay: 0,
      rounds: 6,
      seed: 1945237479,
    });
    const first = generate(input, options);
    const locked = first.games
      .filter((g) => g.slotId !== null)
      .filter((_, i) => i % 3 === 0)
      .map((g) => ({ gameKey: g.key, slotId: g.slotId as string }));
    const pinned = { ...input, locked };
    const again = generate(pinned, options);
    expect(validate(pinned, again)).toEqual([]);
  });
});
