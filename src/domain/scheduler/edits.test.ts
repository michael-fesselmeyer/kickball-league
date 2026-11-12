import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyEdit, reoptimize, type Edit } from "./edits";
import type { Schedule, SchedulerInput } from "./types";
import { validate } from "./validate";
import {
  move,
  NAIVE,
  slot,
  slotId,
  SUNDAYS,
  workedExample,
} from "./worked-example.fixture";

/** Applies an edit that must succeed. */
function edited(input: SchedulerInput, schedule: Schedule, edit: Edit) {
  const result = applyEdit(input, schedule, edit);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const errorCode = (input: SchedulerInput, schedule: Schedule, edit: Edit) => {
  const result = applyEdit(input, schedule, edit);
  return result.ok ? null : result.error.code;
};

const slotOf = (schedule: Schedule, key: string) =>
  schedule.games.find((g) => g.key === key)?.slotId;

describe("applyEdit: move", () => {
  const [input, schedule] = workedExample();

  it("moves a game to an empty slot and pins it there", () => {
    const to = slotId(0, 1, 0);
    const result = edited(input, schedule, {
      kind: "move",
      gameKey: "r1:A:H",
      slotId: to,
    });
    expect(slotOf(result.schedule, "r1:A:H")).toBe(to);
    expect(result.locked).toEqual([{ gameKey: "r1:A:H", slotId: to }]);
    expect(result.violations).toEqual([]);
    // A trades an 11:30 game for a 10:00 one: 2/3/2 becomes 3/2/2.
    const teamA = (m: typeof result.metrics) =>
      m.teams.find((t) => t.teamId === "A")?.byTimeIndex;
    expect(teamA(result.metricsBefore)).toEqual([2, 3, 2]);
    expect(teamA(result.metrics)).toEqual([3, 2, 2]);
  });

  it("can leave the game unpinned", () => {
    const result = edited(input, schedule, {
      kind: "move",
      gameKey: "r1:A:H",
      slotId: slotId(0, 1, 0),
      pin: false,
    });
    expect(result.locked).toEqual([]);
  });

  it("keeps the edit but reports what it breaks", () => {
    // A round 2 game moved into week 1: H and F would play twice that day.
    const result = edited(input, schedule, {
      kind: "move",
      gameKey: "r2:F:H",
      slotId: slotId(0, 1, 0),
    });
    expect(slotOf(result.schedule, "r2:F:H")).toBe(slotId(0, 1, 0));
    expect(new Set(result.violations.map((v) => v.rule))).toEqual(
      new Set(["H6", "H10"]),
    );
  });

  it("refuses unknown games and slots, and taken slots", () => {
    expect(
      errorCode(input, schedule, {
        kind: "move",
        gameKey: "r9:X:Y",
        slotId: slotId(0, 1, 0),
      }),
    ).toBe("unknown_game");
    expect(
      errorCode(input, schedule, {
        kind: "move",
        gameKey: "r1:A:H",
        slotId: "nowhere",
      }),
    ).toBe("unknown_slot");
    expect(
      applyEdit(input, schedule, {
        kind: "move",
        gameKey: "r1:A:H",
        slotId: slotId(0, 0, 0),
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "slot_taken",
        message: `Slot ${slotId(0, 0, 0)} already holds r1:B:G; swap the two games instead.`,
      },
    });
  });

  it("allows moving a game to the slot it is already in", () => {
    const result = edited(input, schedule, {
      kind: "move",
      gameKey: "r1:A:H",
      slotId: slotId(0, 1, 1),
    });
    expect(result.schedule).toEqual(schedule);
  });
});

describe("applyEdit: swap", () => {
  const [input, schedule] = workedExample();

  it("trades two games' slots and pins both", () => {
    const result = edited(input, schedule, {
      kind: "swap",
      gameKeys: ["r1:B:G", "r1:C:F"],
    });
    expect(slotOf(result.schedule, "r1:B:G")).toBe(slotId(0, 1, 2));
    expect(slotOf(result.schedule, "r1:C:F")).toBe(slotId(0, 0, 0));
    expect(result.locked).toHaveLength(2);
    expect(result.violations).toEqual([]);
  });

  it("swaps a placed game with an unplaced one", () => {
    const unplacedFirst = move(schedule, 1, "A-H", null);
    const result = edited(input, unplacedFirst, {
      kind: "swap",
      gameKeys: ["r1:A:H", "r1:B:G"],
    });
    expect(slotOf(result.schedule, "r1:A:H")).toBe(slotId(0, 0, 0));
    expect(slotOf(result.schedule, "r1:B:G")).toBeNull();
    expect(result.schedule.unplaced).toEqual(["r1:B:G"]);
    expect(result.locked).toEqual([
      { gameKey: "r1:A:H", slotId: slotId(0, 0, 0) },
    ]);
  });

  it("can leave both unpinned, and refuses unknown games", () => {
    const result = edited(input, schedule, {
      kind: "swap",
      gameKeys: ["r1:B:G", "r1:C:F"],
      pin: false,
    });
    expect(result.locked).toEqual([]);
    expect(
      errorCode(input, schedule, {
        kind: "swap",
        gameKeys: ["r1:B:G", "nope"],
      }),
    ).toBe("unknown_game");
    expect(
      errorCode(input, schedule, {
        kind: "swap",
        gameKeys: ["nope", "r1:B:G"],
      }),
    ).toBe("unknown_game");
  });
});

describe("applyEdit: pins", () => {
  const [input, schedule] = workedExample();

  it("pins and unpins a game", () => {
    const pinned = edited(input, schedule, { kind: "pin", gameKey: "r3:A:F" });
    expect(pinned.locked).toEqual([
      { gameKey: "r3:A:F", slotId: slotId(2, 0, 1) },
    ]);
    const unpinned = edited({ ...input, locked: pinned.locked }, schedule, {
      kind: "unpin",
      gameKey: "r3:A:F",
    });
    expect(unpinned.locked).toEqual([]);
  });

  it("refuses to pin a game with no slot, or an unknown game", () => {
    const unplaced = move(schedule, 3, "A-F", null);
    expect(errorCode(input, unplaced, { kind: "pin", gameKey: "r3:A:F" })).toBe(
      "not_placed",
    );
    expect(errorCode(input, schedule, { kind: "pin", gameKey: "x" })).toBe(
      "unknown_game",
    );
    expect(errorCode(input, schedule, { kind: "unpin", gameKey: "x" })).toBe(
      "unknown_game",
    );
  });

  it("moves a pin with its game", () => {
    const locked = [{ gameKey: "r1:B:G", slotId: slotId(0, 0, 0) }];
    const result = edited({ ...input, locked }, schedule, {
      kind: "swap",
      gameKeys: ["r1:B:G", "r1:C:F"],
      pin: false,
    });
    expect(result.locked).toEqual([
      { gameKey: "r1:B:G", slotId: slotId(0, 1, 2) },
    ]);
    expect(result.violations).toEqual([]);
  });

  it("drops the pin of a pinned game swapped out of its slot", () => {
    const unplacedFirst = move(schedule, 1, "A-H", null);
    const locked = [{ gameKey: "r1:B:G", slotId: slotId(0, 0, 0) }];
    const result = edited({ ...input, locked }, unplacedFirst, {
      kind: "swap",
      gameKeys: ["r1:A:H", "r1:B:G"],
      pin: false,
    });
    expect(result.locked).toEqual([]);
  });
});

describe("applyEdit: swapDates", () => {
  const [input, schedule] = workedExample();

  it("swaps every game between two dates, slot for slot", () => {
    const locked = [{ gameKey: "r1:A:H", slotId: slotId(0, 1, 1) }];
    const result = edited({ ...input, locked }, schedule, {
      kind: "swapDates",
      dates: [SUNDAYS[0], SUNDAYS[1]],
    });
    expect(slotOf(result.schedule, "r1:A:H")).toBe(slotId(1, 1, 1));
    expect(slotOf(result.schedule, "r2:A:G")).toBe(slotId(0, 1, 0));
    expect(result.locked).toEqual([
      { gameKey: "r1:A:H", slotId: slotId(1, 1, 1) },
    ]);
    expect(result.violations).toEqual([]);
  });

  it("refuses the same date twice, and dates whose slots do not match", () => {
    expect(
      errorCode(input, schedule, {
        kind: "swapDates",
        dates: [SUNDAYS[0], SUNDAYS[0]],
      }),
    ).toBe("same_date");
    const extra = slot("extra", SUNDAYS[0], "F3", 0);
    const withExtra = { ...input, slots: [...input.slots, extra] };
    const onExtra = move(schedule, 1, "A-H", "extra");
    expect(
      errorCode(withExtra, onExtra, {
        kind: "swapDates",
        dates: [SUNDAYS[0], SUNDAYS[1]],
      }),
    ).toBe("no_matching_slot");
  });
});

describe("reoptimize", () => {
  it("improves the season around the admin's pins", () => {
    const locked = [{ gameKey: "r1:A:H", slotId: slotId(0, 0, 0) }];
    const [input, naive] = workedExample({ locked }, NAIVE);
    const result = reoptimize(input, naive, { iterations: 30_000 });
    expect(slotOf(result.schedule, "r1:A:H")).toBe(slotId(0, 0, 0));
    expect(result.violations).toEqual([]);
    expect(result.metrics.timeSlotSpread.value).toBeLessThanOrEqual(2);
  });
});

describe("applyEdit properties", () => {
  const [input, schedule] = workedExample();
  const keys = schedule.games.map((g) => g.key);
  const slotIds = input.slots.map((s) => s.id);
  const anyEdit: fc.Arbitrary<Edit> = fc.oneof(
    fc.record({
      kind: fc.constant("move" as const),
      gameKey: fc.constantFrom(...keys),
      slotId: fc.constantFrom(...slotIds),
    }),
    fc.record({
      kind: fc.constant("swap" as const),
      gameKeys: fc.tuple(fc.constantFrom(...keys), fc.constantFrom(...keys)),
    }),
    fc.record({
      kind: fc.constant("pin" as const),
      gameKey: fc.constantFrom(...keys),
    }),
    fc.record({
      kind: fc.constant("swapDates" as const),
      dates: fc.tuple(fc.constantFrom(...SUNDAYS), fc.constantFrom(...SUNDAYS)),
    }),
  );

  it("P13: returns exactly the violations validate finds after a run of edits", () => {
    fc.assert(
      fc.property(
        fc.array(anyEdit, { minLength: 1, maxLength: 6 }),
        (edits) => {
          let current = schedule;
          let locked = input.locked;
          for (const edit of edits) {
            const attempt = applyEdit({ ...input, locked }, current, edit);
            if (!attempt.ok) continue;
            const result = attempt.value;
            expect(result.violations).toEqual(
              validate({ ...input, locked: result.locked }, result.schedule),
            );
            // Every pin points at the slot its game is in.
            for (const lock of result.locked)
              expect(slotOf(result.schedule, lock.gameKey)).toBe(lock.slotId);
            current = result.schedule;
            locked = result.locked;
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("applyEdit: swapDates with unplaced games", () => {
  it("leaves unplaced games where they are", () => {
    const [input, schedule] = workedExample();
    const withUnplaced = move(schedule, 3, "A-F", null);
    const result = edited(input, withUnplaced, {
      kind: "swapDates",
      dates: [SUNDAYS[0], SUNDAYS[1]],
    });
    expect(slotOf(result.schedule, "r3:A:F")).toBeNull();
  });
});

describe("applyEdit and the scheduler's notes", () => {
  it("drops a note about a game the edit places, and keeps the others", () => {
    const [input, schedule] = workedExample();
    const unplaced = move(schedule, 3, "A-F", null);
    const notes = {
      ...unplaced,
      diagnostics: [
        "Game r3:A:F could not be placed on 2027-04-18: no free slot suits both teams.",
        "Not enough slots: 1 round could not be given a date.",
      ],
    };
    const result = edited(input, notes, {
      kind: "move",
      gameKey: "r3:A:F",
      slotId: slotId(2, 1, 0),
    });
    expect(result.schedule.diagnostics).toEqual([
      "Not enough slots: 1 round could not be given a date.",
    ]);
  });
});
