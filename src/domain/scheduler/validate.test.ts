import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { gameKey, type Schedule, type SchedulerInput } from "./types";
import { validate, type Violation } from "./validate";
import {
  move,
  slot,
  slotId,
  SUNDAYS,
  workedExample,
} from "./worked-example.fixture";

const rules = (violations: Violation[]) => [
  ...new Set(violations.map((v) => v.rule)),
];

describe("validate", () => {
  it("passes the worked example's optimized schedule", () => {
    expect(validate(...workedExample())).toEqual([]);
  });

  it("H1: reports a slot holding two games", () => {
    const [input, schedule] = workedExample();
    const broken = move(schedule, 1, "B-G", slotId(0, 0, 1));
    expect(validate(input, broken)).toEqual([
      {
        rule: "H1",
        message: `Slot ${slotId(0, 0, 1)} holds 2 games.`,
        gameKeys: ["r1:B:G", "r1:D:E"],
      },
    ]);
  });

  it("H1: reports a game listed twice", () => {
    const [input, schedule] = workedExample();
    const [first] = schedule.games;
    const broken = {
      ...schedule,
      games: [...schedule.games, { ...first!, slotId: null }],
    };
    expect(rules(validate(input, broken))).toContain("H1");
  });

  it("H2: reports a team in two games at once", () => {
    // Doubleheaders allowed and a smaller reserve, so only H2 is broken.
    const [input, schedule] = workedExample({
      gamesPerTeamPerDay: 2,
      reservePerDay: 1,
    });
    const broken = move(schedule, 2, "B-E", slotId(0, 1, 0));
    const violations = validate(input, broken);
    expect(rules(violations)).toEqual(["H2"]);
    expect(violations[0]?.message).toBe(
      "Team B plays 2 games at once on 2027-04-04 (time slot 1).",
    );
  });

  it("H3: reports a slot that does not exist", () => {
    const [input, schedule] = workedExample();
    const violations = validate(input, move(schedule, 1, "A-H", "nowhere"));
    expect(violations).toEqual([
      {
        rule: "H3",
        message: "Game r1:A:H is in slot nowhere, which does not exist.",
        gameKeys: ["r1:A:H"],
      },
    ]);
  });

  it("H4: reports a team playing when it is unavailable", () => {
    const [input, schedule] = workedExample({
      constraints: [{ teamId: "A", kind: "unavailable", date: SUNDAYS[0] }],
    });
    expect(validate(input, schedule)).toEqual([
      {
        rule: "H4",
        message:
          "Team A is unavailable on 2027-04-04 (time slot 2) but plays r1:A:H then.",
        gameKeys: ["r1:A:H"],
      },
    ]);
  });

  it("H4: honours a time-only constraint, and ignores prefer and avoid", () => {
    const [input, schedule] = workedExample({
      constraints: [
        { teamId: "B", kind: "unavailable", timeIndex: 2 },
        { teamId: "A", kind: "avoid", date: SUNDAYS[0] },
        { teamId: "A", kind: "prefer", timeIndex: 0 },
      ],
    });
    const violations = validate(input, schedule);
    expect(rules(violations)).toEqual(["H4"]);
    expect(violations.flatMap((v) => v.gameKeys)).toEqual(["r3:B:C", "r4:B:H"]);
  });

  it("H5: reports a rematch before every pair has met", () => {
    const [input, schedule] = workedExample();
    // Round 1 plays A-G and B-H instead of A-H and B-G; round 2 has A-G again.
    const swap: Record<string, [string, string]> = {
      "r1:A:H": ["A", "G"],
      "r1:B:G": ["B", "H"],
    };
    const broken = {
      ...schedule,
      games: schedule.games.map((g) => {
        const teams = swap[g.key];
        return teams
          ? {
              ...g,
              key: gameKey(1, ...teams),
              teamA: teams[0],
              teamB: teams[1],
            }
          : g;
      }),
    };
    expect(validate(input, broken)).toEqual([
      {
        rule: "H5",
        message:
          "After round 2, teams A and G have met 2 times while another pair has met 0.",
        gameKeys: ["r1:A:G", "r2:A:G"],
      },
    ]);
  });

  it("H5: checks each division as its own pool", () => {
    const game = (round: number, a: string, b: string) => ({
      key: gameKey(round, a, b),
      round,
      teamA: a,
      teamB: b,
      slotId: null,
    });
    const schedule: Schedule = {
      games: [
        game(1, "A", "B"),
        game(1, "C", "D"),
        game(2, "A", "B"),
        game(2, "C", "D"),
      ],
      byes: [],
      unplaced: [],
      diagnostics: [],
    };
    const [base] = workedExample();
    const teams = (divided: boolean) =>
      ["A", "B", "C", "D"].map((id) =>
        divided ? { id, divisionId: id < "C" ? "north" : "south" } : { id },
      );
    expect(validate({ ...base, teams: teams(true) }, schedule)).toEqual([]);
    expect(rules(validate({ ...base, teams: teams(false) }, schedule))).toEqual(
      ["H5"],
    );
  });

  it("H6: reports a team over its games-per-day limit", () => {
    const [input, schedule] = workedExample({ reservePerDay: 1 });
    const violations = validate(
      input,
      move(schedule, 2, "H-F", slotId(0, 1, 0)),
    );
    expect(rules(violations)).toEqual(["H6"]);
    expect(violations.map((v) => v.message)).toEqual([
      "Team H plays 2 games on 2027-04-04; the limit is 1, or 2 with makeups.",
      "Team F plays 2 games on 2027-04-04; the limit is 1, or 2 with makeups.",
    ]);
  });

  it("H6: lets a makeup slot raise a team's day to two games", () => {
    const [input, schedule] = workedExample();
    const makeup = {
      ...slot("makeup", SUNDAYS[0], "F3", 0),
      kind: "makeup_reserve" as const,
    };
    const withMakeup = { ...input, slots: [...input.slots, makeup] };
    expect(validate(withMakeup, move(schedule, 2, "H-F", "makeup"))).toEqual(
      [],
    );
  });

  it("H7: reports a bye in a round with an even team count", () => {
    const [input, schedule] = workedExample();
    const violations = validate(input, {
      ...schedule,
      byes: [{ round: 1, teamId: "A" }],
    });
    expect(rules(violations)).toEqual(["H7"]);
    expect(violations.map((v) => v.message)).toEqual([
      "Round 1 has 1 byes; it should have 0.",
      "In round 1, team A is listed 2 times.",
    ]);
  });

  it("H7: checks byes with an odd team count", () => {
    const [base] = workedExample();
    const input = { ...base, teams: [{ id: "A" }, { id: "B" }, { id: "C" }] };
    const game = (round: number, a: string, b: string) => ({
      key: gameKey(round, a, b),
      round,
      teamA: a,
      teamB: b,
      slotId: null,
    });
    const fair: Schedule = {
      games: [game(1, "B", "C"), game(2, "A", "C"), game(3, "A", "B")],
      byes: [
        { round: 1, teamId: "A" },
        { round: 2, teamId: "B" },
        { round: 3, teamId: "C" },
      ],
      unplaced: [],
      diagnostics: [],
    };
    expect(validate(input, fair)).toEqual([]);

    const noBye = { ...fair, byes: fair.byes.slice(1) };
    expect(validate(input, noBye).map((v) => v.message)).toEqual([
      "Round 1 has 0 byes; it should have 1.",
      "In round 1, team A neither plays nor has a bye.",
    ]);

    const unfair: Schedule = {
      ...fair,
      games: [game(1, "B", "C"), game(2, "B", "C")],
      byes: [
        { round: 1, teamId: "A" },
        { round: 2, teamId: "A" },
      ],
    };
    expect(validate(input, unfair).map((v) => v.message)).toContain(
      "Bye counts differ by 2 between teams; they should differ by at most 1.",
    );
  });

  it("H8: reports a doubleheader against the same opponent", () => {
    const date = SUNDAYS[0];
    const [base] = workedExample();
    const input: SchedulerInput = {
      ...base,
      teams: [{ id: "A" }, { id: "B" }],
      slots: [slot("s0", date, "F1", 0), slot("s1", date, "F1", 1)],
      gamesPerTeamPerDay: 2,
      reservePerDay: 0,
    };
    const schedule: Schedule = {
      games: [
        { key: "r1:A:B", round: 1, teamA: "A", teamB: "B", slotId: "s0" },
        { key: "r2:A:B", round: 2, teamA: "B", teamB: "A", slotId: "s1" },
      ],
      byes: [],
      unplaced: [],
      diagnostics: [],
    };
    expect(validate(input, schedule)).toEqual([
      {
        rule: "H8",
        message: "Teams A and B play each other twice on 2027-04-04.",
        gameKeys: ["r1:A:B", "r2:A:B"],
      },
    ]);
  });

  it("H9: reports a locked game that moved or is missing", () => {
    const [input, schedule] = workedExample({
      locked: [
        { gameKey: "r1:A:H", slotId: slotId(0, 1, 1) },
        { gameKey: "r1:B:G", slotId: slotId(0, 0, 0) },
      ],
    });
    expect(validate(input, schedule)).toEqual([]);
    const moved = move(schedule, 1, "B-G", slotId(0, 1, 0));
    const locked = [
      ...input.locked,
      { gameKey: "r9:A:B", slotId: slotId(0, 0, 0) },
      { gameKey: "r1:C:F", slotId: "x" },
    ];
    const messages = validate({ ...input, locked }, moved).map(
      (v) => v.message,
    );
    expect(messages).toEqual([
      `Locked game r1:B:G moved from ${slotId(0, 0, 0)} to ${slotId(0, 1, 0)}.`,
      `Locked game r9:A:B is missing.`,
      `Locked game r1:C:F moved from x to ${slotId(0, 1, 2)}.`,
    ]);
  });

  it("H10: reports a game moved into a date's makeup reserve", () => {
    const [input, schedule] = workedExample({ gamesPerTeamPerDay: 2 });
    expect(validate(input, move(schedule, 2, "H-F", slotId(0, 1, 0)))).toEqual([
      {
        rule: "H10",
        message: "2027-04-04 keeps 1 empty slot for makeups; it should keep 2.",
        gameKeys: ["r2:F:H"],
      },
    ]);
  });

  it("H10: asks only for the reserve a date has room for", () => {
    const [input, schedule] = workedExample({ reservePerDay: 3 });
    expect(validate(input, schedule)).toEqual([]);
  });

  it("accepts unplaced games", () => {
    const [input, schedule] = workedExample();
    expect(validate(input, move(schedule, 3, "A-F", null))).toEqual([]);
  });
});

describe("validate on arbitrary schedules", () => {
  const [base] = workedExample();
  const team = fc.constantFrom(..."ABCDEFGH".split(""));
  const arbitrarySchedule = fc
    .array(
      fc.record({
        round: fc.integer({ min: 1, max: 9 }),
        teamA: team,
        teamB: team,
        slotId: fc.option(
          fc.constantFrom(...base.slots.map((s) => s.id), "gone"),
          {
            nil: null,
          },
        ),
      }),
      { maxLength: 40 },
    )
    .map((games) => ({
      games: games.map((g) => ({
        ...g,
        key: gameKey(g.round, g.teamA, g.teamB),
      })),
      byes: [],
      unplaced: [],
      diagnostics: [],
    }));

  it("never throws, is deterministic, and reports only known rules", () => {
    fc.assert(
      fc.property(arbitrarySchedule, (schedule) => {
        const first = validate(base, schedule);
        expect(validate(base, schedule)).toEqual(first);
        for (const v of first) {
          expect(v.rule).toMatch(/^H(10|[1-9])$/);
          expect(v.message.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe("validate edge cases", () => {
  const [base] = workedExample();
  const game = (
    round: number,
    a: string,
    b: string,
    slot: string | null = null,
  ) => ({
    key: gameKey(round, a, b),
    round,
    teamA: a,
    teamB: b,
    slotId: slot,
  });
  const scheduleOf = (games: Schedule["games"]): Schedule => ({
    games,
    byes: [],
    unplaced: [],
    diagnostics: [],
  });

  it("says when a locked game has lost its slot", () => {
    const [input, schedule] = workedExample({
      locked: [{ gameKey: "r1:A:H", slotId: slotId(0, 1, 1) }],
    });
    expect(validate(input, move(schedule, 1, "A-H", null))).toEqual([
      {
        rule: "H9",
        message: `Locked game r1:A:H moved from ${slotId(0, 1, 1)} to no slot.`,
        gameKeys: ["r1:A:H"],
      },
    ]);
  });

  it("skips a one-team division, and rounds a division does not play", () => {
    const input = {
      ...base,
      teams: [
        { id: "A", divisionId: "x" },
        { id: "B", divisionId: "x" },
        { id: "C", divisionId: "y" },
        { id: "D", divisionId: "y" },
        { id: "E", divisionId: "solo" },
      ],
    };
    const schedule = scheduleOf([
      game(1, "A", "B"),
      game(1, "C", "D"),
      game(2, "A", "B"),
    ]);
    expect(validate(input, schedule)).toEqual([]);
  });

  it("uses the plural for an empty reserve", () => {
    const [input, schedule] = workedExample({ gamesPerTeamPerDay: 2 });
    // One game each from rounds 2 and 3 fills week 1's two empty slots.
    const full = move(
      move(schedule, 2, "H-F", slotId(0, 1, 0)),
      3,
      "G-E",
      slotId(0, 0, 2),
    );
    expect(validate(input, full).find((v) => v.rule === "H10")?.message).toBe(
      "2027-04-04 keeps 0 empty slots for makeups; it should keep 2.",
    );
  });
});
