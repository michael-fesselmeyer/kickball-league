import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { err } from "../result";
import {
  CATEGORIES,
  CATEGORY_KEYS,
  checkVote,
  defaultTitle,
  gameDayLabel,
  isCategory,
  type Nominee,
  parsePollForm,
  pollState,
  tally,
  winnerLine,
} from "./awards";

const at = (iso: string) => new Date(iso);
const poll = {
  opensAt: at("2026-10-05T12:00:00Z"),
  closesAt: at("2026-10-08T01:00:00Z"),
};

describe("poll state", () => {
  it("is upcoming, then open, then closed at closes_at exactly", () => {
    expect(pollState(poll, at("2026-10-05T11:59:59Z"))).toBe("upcoming");
    expect(pollState(poll, poll.opensAt)).toBe("open");
    expect(pollState(poll, at("2026-10-08T00:59:59Z"))).toBe("open");
    expect(pollState(poll, poll.closesAt)).toBe("closed");
  });
});

describe("categories", () => {
  it("knows its categories and who can win each", () => {
    expect(isCategory("mvp")).toBe(true);
    expect(isCategory("toString")).toBe(false);
    expect(
      CATEGORY_KEYS.filter((c) => CATEGORIES[c].nominee === "team"),
    ).toEqual(["team_spirit", "best_dressed"]);
  });

  it("names a poll for its game day or season", () => {
    expect(gameDayLabel("2026-10-05")).toBe("Mon, Oct 5");
    expect(defaultTitle("weekly", "mvp", "2026-10-05", "Fall 2026")).toBe(
      "MVP, Mon, Oct 5",
    );
    expect(defaultTitle("season", "best_sport", null, "Fall 2026")).toBe(
      "Fall 2026 Best sport",
    );
  });
});

describe("the new-poll form", () => {
  const context = {
    now: at("2026-10-06T16:00:00Z"),
    timeZone: "America/New_York",
    seasonName: "Fall 2026",
    gameDays: ["2026-09-28", "2026-10-05"],
  };
  const form = {
    kind: "weekly",
    category: "mvp",
    gameDay: "2026-10-05",
    title: "",
    closesOn: "2026-10-08",
    closesTime: "21:00",
  };

  it("opens now and closes on the league's wall clock", () => {
    const parsed = parsePollForm(form, context);
    expect(parsed).toEqual({
      ok: true,
      value: {
        kind: "weekly",
        category: "mvp",
        gameDay: "2026-10-05",
        title: "MVP, Mon, Oct 5",
        opensAt: context.now,
        // 9 PM in New York in October is 1 AM UTC the next day.
        closesAt: at("2026-10-09T01:00:00Z"),
      },
    });
  });

  it("keeps a written title, tidied, and drops the game day for a season poll", () => {
    const parsed = parsePollForm(
      { ...form, kind: "season", title: "  Golden   Sneaker  " },
      context,
    );
    expect(parsed.ok && parsed.value).toMatchObject({
      kind: "season",
      gameDay: null,
      title: "Golden Sneaker",
    });
  });

  it.each([
    [{ kind: "monthly" }, "bad_kind"],
    [{ category: "best_hat" }, "bad_category"],
    [{ gameDay: "" }, "pick_game_day"],
    [{ gameDay: "2026-10-12" }, "unknown_game_day"],
    [{ closesOn: "" }, "bad_close"],
    [{ closesTime: "25:00" }, "bad_close"],
    [{ closesOn: "2026-10-06", closesTime: "08:00" }, "close_in_past"],
    [{ title: "x".repeat(81) }, "title_too_long"],
  ] as const)("refuses %o with %s", (change, error) => {
    expect(parsePollForm({ ...form, ...change }, context)).toEqual(err(error));
  });
});

describe("checking a vote", () => {
  const ballot: Nominee[] = [
    {
      id: "robin",
      kind: "player",
      name: "Robin E.",
      teamSeasonId: "aces",
      teamName: "Aces",
    },
    {
      id: "alex",
      kind: "player",
      name: "Alex S.",
      teamSeasonId: "bees",
      teamName: "Bees",
    },
  ];
  const teams: Nominee[] = [
    {
      id: "aces",
      kind: "team",
      name: "Aces",
      teamSeasonId: "aces",
      teamName: "Aces",
    },
    {
      id: "bees",
      kind: "team",
      name: "Bees",
      teamSeasonId: "bees",
      teamName: "Bees",
    },
  ];
  const open = at("2026-10-06T12:00:00Z");
  const vote = (over: Partial<Parameters<typeof checkVote>[0]> = {}) =>
    checkVote({
      poll: { ...poll, category: "mvp" },
      now: open,
      voter: { userId: "robin", teamSeasonId: "aces" },
      nomineeId: "alex",
      ballot,
      ...over,
    });

  it("accepts a pick from the ballot, teammates included", () => {
    expect(vote()).toEqual({ ok: true, value: ballot[1] });
    expect(
      vote({
        voter: { userId: "casey", teamSeasonId: "aces" },
        nomineeId: "robin",
      }),
    ).toEqual({ ok: true, value: ballot[0] });
  });

  it("refuses outside the voting window", () => {
    expect(vote({ now: at("2026-10-05T11:00:00Z") })).toEqual(err("not_open"));
    expect(vote({ now: poll.closesAt })).toEqual(err("not_open"));
  });

  it("refuses someone not on a roster", () => {
    expect(vote({ voter: { userId: "fran", teamSeasonId: null } })).toEqual(
      err("not_on_roster"),
    );
  });

  it("refuses a pick off the ballot, or of the wrong kind", () => {
    expect(vote({ nomineeId: "nobody" })).toEqual(err("not_a_nominee"));
    expect(vote({ nomineeId: "bees", ballot: [...ballot, ...teams] })).toEqual(
      err("not_a_nominee"),
    );
  });

  it("refuses a vote for yourself, or your own team", () => {
    expect(vote({ nomineeId: "robin" })).toEqual(err("self_vote"));
    const team = {
      poll: { ...poll, category: "team_spirit" as const },
      ballot: teams,
    };
    expect(vote({ ...team, nomineeId: "aces" })).toEqual(err("own_team"));
    expect(vote({ ...team, nomineeId: "bees" })).toEqual({
      ok: true,
      value: teams[1],
    });
  });
});

describe("the tally", () => {
  it("ranks by votes and adds up repeats", () => {
    expect(
      tally([
        { nomineeId: "b", votes: 2 },
        { nomineeId: "a", votes: 5 },
        { nomineeId: "b", votes: 1 },
        { nomineeId: "c", votes: 0 },
      ]),
    ).toEqual({
      rows: [
        { nomineeId: "a", votes: 5, rank: 1 },
        { nomineeId: "b", votes: 3, rank: 2 },
      ],
      winners: ["a"],
      total: 8,
    });
  });

  it("shares a rank in a tie and skips the next one", () => {
    const counted = tally([
      { nomineeId: "c", votes: 1 },
      { nomineeId: "b", votes: 4 },
      { nomineeId: "a", votes: 4 },
      { nomineeId: "d", votes: 1 },
    ]);
    expect(counted.rows).toEqual([
      { nomineeId: "a", votes: 4, rank: 1 },
      { nomineeId: "b", votes: 4, rank: 1 },
      { nomineeId: "c", votes: 1, rank: 3 },
      { nomineeId: "d", votes: 1, rank: 3 },
    ]);
    expect(counted.winners).toEqual(["a", "b"]);
  });

  it("has no winner without votes", () => {
    expect(tally([])).toEqual({ rows: [], winners: [], total: 0 });
  });

  const counts = fc.array(
    fc.record({
      nomineeId: fc.constantFrom("a", "b", "c", "d", "e"),
      votes: fc.nat({ max: 20 }),
    }),
  );

  it("keeps every vote and lists each nominee once", () => {
    fc.assert(
      fc.property(counts, (input) => {
        const { rows, total } = tally(input);
        expect(total).toBe(input.reduce((s, c) => s + c.votes, 0));
        expect(new Set(rows.map((r) => r.nomineeId)).size).toBe(rows.length);
      }),
    );
  });

  it("ranks in order, ties share a rank, and every winner has the most votes", () => {
    fc.assert(
      fc.property(counts, (input) => {
        const { rows, winners } = tally(input);
        rows.forEach((r, i) => {
          const before = rows[i - 1];
          if (!before) return expect(r.rank).toBe(1);
          expect(r.votes).toBeLessThanOrEqual(before.votes);
          expect(r.rank).toBe(r.votes === before.votes ? before.rank : i + 1);
        });
        const most = Math.max(0, ...rows.map((r) => r.votes));
        expect(winners).toEqual(
          rows.filter((r) => r.votes === most).map((r) => r.nomineeId),
        );
      }),
    );
  });

  it("does not depend on the order votes are read in", () => {
    fc.assert(
      fc.property(counts, (input) => {
        expect(tally([...input].reverse())).toEqual(tally(input));
      }),
    );
  });
});

describe("the winner line", () => {
  it("names one winner or everyone tied", () => {
    expect(winnerLine([])).toBeNull();
    expect(winnerLine(["Robin E."])).toBe("Robin E. wins");
    expect(winnerLine(["Robin E.", "Alex S."])).toBe(
      "Robin E. and Alex S. tie",
    );
    expect(winnerLine(["A", "B", "C"])).toBe("A, B and C tie");
  });
});
