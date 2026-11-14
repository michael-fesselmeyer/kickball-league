import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  attendanceAt,
  careerStats,
  computeAwards,
  coverageNote,
  DEFAULT_MVP_WEIGHTS,
  enoughGames,
  fillWithAverage,
  formatValue,
  type PlayerGame,
  type PlayerSeason,
  parseNote,
  parseWeights,
  partsLine,
  rank,
  seasonStats,
  STAT_AWARD_KEYS,
  weightedScore,
  winnersOf,
} from "./stat-awards";

const played = (over: Partial<PlayerGame> = {}): PlayerGame => ({
  attendance: "played",
  won: false,
  liveRuns: null,
  rating: null,
  ...over,
});
const missed = (): PlayerGame => played({ attendance: "missed" });
const unknown = (): PlayerGame => played({ attendance: "unknown" });

const player = (
  userId: string,
  games: PlayerGame[],
  over: Partial<PlayerSeason> = {},
): PlayerSeason => ({
  userId,
  games,
  subAppearances: 0,
  mvpVotes: 0,
  bestSportVotes: 0,
  firstSeason: false,
  ...over,
});

describe("coverage", () => {
  it("needs three recorded games and at least half of them", () => {
    expect(enoughGames(2, 2)).toBe(false);
    expect(enoughGames(3, 6)).toBe(true);
    expect(enoughGames(3, 7)).toBe(false);
    expect(enoughGames(8, 8)).toBe(true);
  });

  it("says what a stat is based on", () => {
    expect(coverageNote(7, 9)).toBe("based on 7 of 9 games");
    expect(coverageNote(1, 1)).toBe("based on 1 of 1 game");
  });
});

describe("attendanceAt", () => {
  const base = {
    lineupSaved: false,
    inLineup: false,
    rsvp: null,
    checkedInThatDay: false,
  } as const;

  it("trusts a saved kicking order first", () => {
    expect(attendanceAt({ ...base, lineupSaved: true, inLineup: true })).toBe(
      "played",
    );
    expect(attendanceAt({ ...base, lineupSaved: true, rsvp: "in" })).toBe(
      "missed",
    );
  });

  it("falls back to the RSVP, then a bar check-in that day", () => {
    expect(attendanceAt({ ...base, rsvp: "in" })).toBe("played");
    expect(attendanceAt({ ...base, rsvp: "out", checkedInThatDay: true })).toBe(
      "missed",
    );
    expect(attendanceAt({ ...base, rsvp: "maybe" })).toBe("unknown");
    expect(attendanceAt({ ...base, checkedInThatDay: true })).toBe("played");
    expect(attendanceAt(base)).toBe("unknown");
  });
});

describe("seasonStats", () => {
  it("counts attendance over recorded games only", () => {
    const s = seasonStats(
      player("a", [played({ won: true }), played(), missed(), unknown()]),
    );
    expect(s).toMatchObject({
      teamGames: 4,
      recorded: 3,
      gamesPlayed: 2,
      wins: 1,
    });
    expect(s.attendanceRate).toBeCloseTo(2 / 3);
  });

  it("hides attendance and runs without enough recorded games", () => {
    const s = seasonStats(
      player("a", [played({ liveRuns: 5 }), unknown(), unknown(), unknown()]),
    );
    expect(s.attendanceRate).toBeNull();
    expect(s.runs).toBeNull();
    expect(s.liveRuns).toBe(5);
  });

  it("adds team runs from live-scored games played", () => {
    const s = seasonStats(
      player("a", [
        played({ liveRuns: 4 }),
        played({ liveRuns: 6 }),
        played({ liveRuns: 1 }),
        played(),
        missed(),
      ]),
    );
    expect(s.liveGames).toBe(3);
    expect(s.runs).toBe(11);
  });

  it("averages sportsmanship over rated games played", () => {
    const s = seasonStats(
      player("a", [
        played({ rating: 5 }),
        played({ rating: 4 }),
        played({ rating: 3 }),
        missed(),
      ]),
    );
    expect(s.sportsmanship).toBe(4);
  });
});

describe("careerStats", () => {
  it("adds counts and works rates out from the totals", () => {
    const one = seasonStats(
      player("a", [played({ liveRuns: 2 }), played({ liveRuns: 3 }), missed()]),
    );
    const two = seasonStats(
      player("a", [played({ liveRuns: 4, won: true }), missed(), missed()]),
    );
    const c = careerStats([one, two]);
    expect(c).toMatchObject({
      seasons: 2,
      teamGames: 6,
      gamesPlayed: 3,
      wins: 1,
      liveGames: 3,
      runs: 9,
    });
    expect(c.attendanceRate).toBeCloseTo(0.5);
  });

  it("is empty for no seasons", () => {
    expect(careerStats([])).toMatchObject({
      seasons: 0,
      attendanceRate: null,
      runs: null,
    });
  });
});

describe("rank", () => {
  it("shares a place between ties and skips the next", () => {
    const leaders = rank([
      { userId: "b", value: 9 },
      { userId: "a", value: 9 },
      { userId: "c", value: 7 },
      { userId: "d", value: 6 },
    ]);
    expect(leaders).toEqual([
      { userId: "a", value: 9, place: 1 },
      { userId: "b", value: 9, place: 1 },
      { userId: "c", value: 7, place: 3 },
    ]);
    expect(winnersOf(leaders)).toEqual(["a", "b"]);
  });

  it("compares values as shown, to one decimal place", () => {
    const leaders = rank([
      { userId: "a", value: 87.51 },
      { userId: "b", value: 87.54 },
    ]);
    expect(leaders.map((l) => l.place)).toEqual([1, 1]);
  });

  it("breaks a tie with the tie-break, and shares a tie on both", () => {
    const leaders = rank([
      { userId: "a", value: 100, tiebreak: 3 },
      { userId: "b", value: 100, tiebreak: 4 },
      { userId: "c", value: 100, tiebreak: 4 },
      { userId: "d", value: 90, tiebreak: 9 },
    ]);
    expect(leaders.map((l) => [l.userId, l.place])).toEqual([
      ["b", 1],
      ["c", 1],
      ["a", 3],
    ]);
  });

  it("leaves out zeroes", () => {
    expect(rank([{ userId: "a", value: 0 }])).toEqual([]);
  });

  it("keeps everyone tied at the last place kept", () => {
    const leaders = rank(
      ["a", "b", "c", "d", "e"].map((userId, i) => ({
        userId,
        value: i < 2 ? 5 : 3,
      })),
    );
    expect(leaders).toHaveLength(5);
    expect(leaders.at(-1)?.place).toBe(3);
  });

  it("property: places never decrease, ties share one, the first is 1", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            userId: fc.string({ minLength: 1, maxLength: 4 }),
            value: fc.integer({ min: 0, max: 20 }),
          }),
          { selector: (e) => e.userId, maxLength: 30 },
        ),
        (entries) => {
          const leaders = rank(entries, 99);
          leaders.forEach((l, i) => {
            const prev = leaders[i - 1];
            if (!prev) return expect(l.place).toBe(1);
            expect(l.value).toBeLessThanOrEqual(prev.value);
            expect(l.place).toBe(l.value === prev.value ? prev.place : i + 1);
          });
          const top = Math.max(0, ...entries.map((e) => e.value));
          expect(winnersOf(leaders).sort()).toEqual(
            top > 0
              ? entries
                  .filter((e) => e.value === top)
                  .map((e) => e.userId)
                  .sort()
              : [],
          );
        },
      ),
    );
  });
});

describe("fillWithAverage", () => {
  it("fills gaps with the average of the rest", () => {
    expect(fillWithAverage([1, null, 0.5])).toEqual([1, 0.75, 0.5]);
    expect(fillWithAverage([null, null])).toEqual([null, null]);
  });
});

describe("weightedScore", () => {
  it("weights parts and leaves out missing ones", () => {
    expect(weightedScore({ a: 1, b: 0 }, { a: 3, b: 1 })).toBe(75);
    expect(weightedScore({ a: 1, b: null }, { a: 3, b: 1 })).toBe(100);
    expect(weightedScore({ a: null }, { a: 3 })).toBeNull();
    expect(weightedScore({ a: 1 }, { a: 0 })).toBeNull();
  });

  it("property: stays between 0 and 100", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.constantFrom("runs", "wins", "attendance", "votes"),
          fc.option(fc.double({ min: 0, max: 1, noNaN: true })),
        ),
        fc.record({
          runs: fc.integer({ min: 0, max: 10 }),
          wins: fc.integer({ min: 0, max: 10 }),
          attendance: fc.integer({ min: 0, max: 10 }),
          votes: fc.integer({ min: 0, max: 10 }),
        }),
        (parts, weights) => {
          const score = weightedScore(parts, weights);
          if (score !== null) {
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(100 + 1e-9);
          }
        },
      ),
    );
  });
});

/** Five final games where the player played each, won `wins` of them. */
const season = (wins: number, runs: number | null, over = {}) =>
  Array.from({ length: 5 }, (_, i) =>
    played({ won: i < wins, liveRuns: runs, ...over }),
  );

describe("computeAwards", () => {
  it("names a winner for every award from the right numbers", () => {
    const players = [
      player("ace", season(5, 6), { mvpVotes: 6, firstSeason: true }),
      player("bea", season(2, 2), { mvpVotes: 2, bestSportVotes: 4 }),
      player("cal", [...season(3, 4).slice(0, 3), missed(), missed()], {
        subAppearances: 3,
      }),
    ];
    const r = computeAwards(players, DEFAULT_MVP_WEIGHTS);
    expect(winnersOf(r.leaders.season_mvp)).toEqual(["ace"]);
    expect(r.leaders.season_mvp[0]?.value).toBe(100);
    expect(winnersOf(r.leaders.iron_kicker)).toEqual(["ace", "bea"]);
    expect(winnersOf(r.leaders.golden_boot)).toEqual(["ace"]);
    expect(r.leaders.golden_boot[0]?.value).toBe(30);
    expect(winnersOf(r.leaders.best_teammate)).toEqual(["bea"]);
    expect(winnersOf(r.leaders.rookie_of_the_year)).toEqual(["ace"]);
    expect(winnersOf(r.leaders.sub_of_the_year)).toEqual(["cal"]);
    expect(r.votesCounted).toBe(true);
    expect(r.unusedParts).toEqual([]);
  });

  it("gives a tied attendance rate to whoever played more games", () => {
    const r = computeAwards(
      [
        player("three", [played(), played(), played(), unknown(), unknown()]),
        player("five", season(0, null)),
      ],
      DEFAULT_MVP_WEIGHTS,
    );
    expect(r.leaders.iron_kicker.map((l) => [l.userId, l.place])).toEqual([
      ["five", 1],
      ["three", 2],
    ]);
  });

  it("leaves out parts nobody has data for", () => {
    const r = computeAwards(
      [player("a", season(3, null)), player("b", season(1, null))],
      DEFAULT_MVP_WEIGHTS,
    );
    expect(r.unusedParts).toEqual(["runs", "votes"]);
    expect(r.votesCounted).toBe(false);
    // Wins 3 vs 1, attendance equal: a = 100, b = (2*(1/3) + 2*1)/4 = 66.7.
    expect(r.leaders.season_mvp.map((l) => [l.userId, l.value])).toEqual([
      ["a", 100],
      ["b", 66.7],
    ]);
    expect(r.leaders.golden_boot).toEqual([]);
  });

  it("shares an award between players tied on it", () => {
    const r = computeAwards(
      [
        player("a", season(2, 3, { rating: 4 })),
        player("b", season(2, 3, { rating: 4 })),
      ],
      DEFAULT_MVP_WEIGHTS,
    );
    for (const award of STAT_AWARD_KEYS.filter(
      (a) => a !== "sub_of_the_year" && a !== "rookie_of_the_year",
    ))
      expect(winnersOf(r.leaders[award])).toEqual(["a", "b"]);
  });

  it("puts a player without enough live games at the season's average", () => {
    // a and b have runs; c's games weren't live scored. The runs parts
    // scaled are 1 and 0.5, so c gets 0.75.
    const r = computeAwards(
      [
        player("a", season(5, 4)),
        player("b", season(5, 2)),
        player("c", season(5, null)),
      ],
      { runs: 1, wins: 0, attendance: 0, votes: 0 },
    );
    expect(r.mvp.map((m) => [m.userId, m.score])).toEqual([
      ["a", 100],
      ["b", 50],
      ["c", 75],
    ]);
    expect(r.mvp.find((m) => m.userId === "c")?.parts.runs).toBeNull();
  });

  it("needs three games played for the MVP and Best Teammate", () => {
    const r = computeAwards(
      [
        player("there", season(2, null, { rating: 4 })),
        player("absent", [missed(), missed(), missed(), missed(), missed()], {
          mvpVotes: 1,
        }),
      ],
      DEFAULT_MVP_WEIGHTS,
    );
    expect(r.mvp.map((m) => m.userId)).toEqual(["there"]);
    expect(winnersOf(r.leaders.best_teammate)).toEqual(["there"]);
  });

  it("needs recorded attendance before a player can be MVP", () => {
    const r = computeAwards(
      [player("ghost", [unknown(), unknown(), played({ won: true })])],
      DEFAULT_MVP_WEIGHTS,
    );
    expect(r.leaders.season_mvp).toEqual([]);
    expect(r.mvp).toEqual([]);
  });

  it("property: a single player with data is MVP with 100", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.option(fc.integer({ min: 1, max: 20 })),
        (wins, runs) => {
          const r = computeAwards(
            [player("only", season(wins, runs))],
            DEFAULT_MVP_WEIGHTS,
          );
          expect(r.leaders.season_mvp).toEqual([
            { userId: "only", value: 100, place: 1 },
          ]);
        },
      ),
    );
  });

  it("property: the order of players never changes a result", () => {
    const arbitraryPlayer = fc.record({
      userId: fc.uuid(),
      wins: fc.integer({ min: 0, max: 5 }),
      runs: fc.option(fc.integer({ min: 0, max: 9 })),
      subs: fc.integer({ min: 0, max: 4 }),
      votes: fc.integer({ min: 0, max: 5 }),
      sport: fc.integer({ min: 0, max: 5 }),
      first: fc.boolean(),
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(arbitraryPlayer, {
          selector: (p) => p.userId,
          maxLength: 12,
        }),
        (rows) => {
          const players = rows.map((p) =>
            player("x", season(p.wins, p.runs), {
              userId: p.userId,
              subAppearances: p.subs,
              mvpVotes: p.votes,
              bestSportVotes: p.sport,
              firstSeason: p.first,
            }),
          );
          const a = computeAwards(players, DEFAULT_MVP_WEIGHTS);
          const b = computeAwards([...players].reverse(), DEFAULT_MVP_WEIGHTS);
          expect(b.leaders).toEqual(a.leaders);
          for (const award of STAT_AWARD_KEYS)
            for (const l of a.leaders[award]) {
              expect(l.value).toBeGreaterThan(0);
              if (award === "season_mvp" || award === "best_teammate")
                expect(l.value).toBeLessThanOrEqual(100);
            }
        },
      ),
    );
  });
});

describe("forms", () => {
  it("checks the weights", () => {
    expect(
      parseWeights({ runs: "4", wins: "3", attendance: "0", votes: "10" }),
    ).toEqual({
      ok: true,
      value: { runs: 4, wins: 3, attendance: 0, votes: 10 },
    });
    expect(
      parseWeights({ runs: "11", wins: "3", attendance: "0", votes: "1" }).ok,
    ).toBe(false);
    expect(
      parseWeights({ runs: "-1", wins: "3", attendance: "0", votes: "1" }).ok,
    ).toBe(false);
    expect(
      parseWeights({ runs: "0", wins: "0", attendance: "0", votes: "0" }),
    ).toEqual({ ok: false, error: "all_zero" });
  });

  it("tidies a note and refuses a long one", () => {
    expect(parseNote("  Tied  for the\nfirst time  ")).toEqual({
      ok: true,
      value: "Tied for the first time",
    });
    expect(parseNote("   ")).toEqual({ ok: true, value: null });
    expect(parseNote("x".repeat(281)).ok).toBe(false);
  });

  it("writes an MVP score's parts, leaving out missing ones", () => {
    expect(
      partsLine({ runs: 9.666, wins: 0.75, attendance: 1, votes: null }),
    ).toBe(
      "9.7 runs a game · 75% of team games won · 100% attendance · season average for votes",
    );
    expect(
      partsLine({ runs: null, wins: 0.5, attendance: 1, votes: null }, [
        "votes",
      ]),
    ).toBe("50% of team games won · 100% attendance · season average for runs");
  });

  it("formats each award's number", () => {
    expect(formatValue("season_mvp", 87.54)).toBe("87.5 points");
    expect(formatValue("iron_kicker", 100)).toBe("100%");
    expect(formatValue("golden_boot", 1)).toBe("1 run");
    expect(formatValue("sub_of_the_year", 3)).toBe("3 sub games");
  });
});
