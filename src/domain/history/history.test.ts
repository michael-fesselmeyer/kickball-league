import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ResultGame, standings } from "@/domain/standings/standings";
import {
  allTimeRecordOf,
  allTimeRecords,
  pctText,
  recordLine,
  type SeasonResult,
  seasonChampion,
  seasonDates,
  signedText,
} from "./history";

const game = (
  teamA: string,
  scoreA: number,
  teamB: string,
  scoreB: number,
): ResultGame => ({ kind: "played", teamA, teamB, scoreA, scoreB });

const forfeit = (
  teamA: string,
  teamB: string,
  forfeitBy: string,
): ResultGame => ({ kind: "forfeit", teamA, teamB, forfeitBy });

/** A season's result the way the queries build it: from its standings. */
function season(
  seasonId: string,
  teams: readonly string[],
  games: readonly ResultGame[],
  extra: Partial<SeasonResult> = {},
): SeasonResult {
  return {
    seasonId,
    completed: true,
    rows: standings(teams, games, { seed: seasonId }),
    ...extra,
  };
}

describe("seasonChampion", () => {
  const games = [
    game("A", 6, "B", 2),
    game("A", 3, "C", 1),
    game("B", 4, "C", 4),
  ];

  it("crowns the top of the final standings", () => {
    expect(seasonChampion(season("fall", ["A", "B", "C"], games))).toBe("A");
  });

  it("prefers the playoff bracket's winner", () => {
    expect(
      seasonChampion(
        season("fall", ["A", "B", "C"], games, { bracketChampion: "C" }),
      ),
    ).toBe("C");
  });

  it("has no champion before the season is over", () => {
    expect(
      seasonChampion(
        season("fall", ["A", "B", "C"], games, { completed: false }),
      ),
    ).toBeNull();
  });

  it("has no champion when nobody played", () => {
    expect(seasonChampion(season("fall", ["A", "B"], []))).toBeNull();
    expect(
      seasonChampion({ seasonId: "fall", completed: true, rows: [] }),
    ).toBeNull();
  });

  it("has no champion when two teams share first place", () => {
    const rows = standings(["A", "B"], [game("A", 2, "B", 2)], {
      seed: "fall",
      tiebreakers: ["win_pct"],
    });
    expect(rows.map((r) => r.rank)).toEqual([1, 1]);
    expect(seasonChampion({ seasonId: "fall", completed: true, rows })).toBe(
      null,
    );
  });
});

describe("allTimeRecords", () => {
  const seasons = [
    season(
      "spring",
      ["A", "B", "C"],
      [
        game("A", 9, "B", 1),
        game("C", 5, "A", 4),
        game("B", 3, "C", 3),
        game("A", 22, "C", 0),
      ],
    ),
    season(
      "summer",
      ["A", "B", "D"],
      [game("B", 7, "A", 2), forfeit("B", "D", "D"), game("A", 6, "D", 6)],
    ),
    // Still being played: counts toward the record, not the titles.
    season(
      "fall",
      ["A", "B", "D", "E"],
      [game("D", 8, "A", 0), game("D", 2, "B", 1)],
      { completed: false },
    ),
  ];
  const records = allTimeRecords(seasons);
  const of = (team: string) => records.find((r) => r.team === team);

  it("adds up each team's seasons", () => {
    expect(of("A")).toMatchObject({
      seasons: 3,
      played: 6,
      wins: 2,
      losses: 3,
      ties: 1,
      runsFor: 9 + 4 + 22 + 2 + 6 + 0,
      runsAgainst: 1 + 5 + 0 + 7 + 6 + 8,
      // 8 - 1 + 10 (capped from 22) - 5 + 0 - 8
      runDifference: 4,
    });
    expect(recordLine(of("A") as NonNullable<ReturnType<typeof of>>)).toBe(
      "2-3-1",
    );
  });

  it("counts titles from completed seasons only", () => {
    expect(of("A")).toMatchObject({ titles: 1, titleSeasonIds: ["spring"] });
    expect(of("B")).toMatchObject({ titles: 1, titleSeasonIds: ["summer"] });
    expect(of("D")?.titles).toBe(0);
  });

  it("skips a season in which the team played no game", () => {
    expect(of("E")).toBeUndefined();
    expect(allTimeRecordOf("E", seasons)).toMatchObject({
      seasons: 0,
      played: 0,
      winPct: 0,
      titles: 0,
    });
  });

  it("puts the most titles first, then the best win percentage", () => {
    expect(records.map((r) => r.team)).toEqual(["B", "A", "D", "C"]);
  });

  it("counts a forfeit as a win and a loss with no runs", () => {
    expect(of("D")).toMatchObject({ wins: 2, losses: 1, ties: 1 });
    expect(of("D")?.winPct).toBeCloseTo(2.5 / 4);
  });
});

describe("allTimeRecords, for any seasons", () => {
  const TEAMS = ["A", "B", "C", "D", "E"] as const;
  const gameArb = fc
    .record({
      pair: fc
        .tuple(fc.constantFrom(...TEAMS), fc.constantFrom(...TEAMS))
        .filter(([a, b]) => a !== b),
      scoreA: fc.integer({ min: 0, max: 25 }),
      scoreB: fc.integer({ min: 0, max: 25 }),
      forfeit: fc.option(fc.boolean(), { freq: 6 }),
    })
    .map(({ pair: [a, b], scoreA, scoreB, forfeit: f }): ResultGame =>
      f === null ? game(a, scoreA, b, scoreB) : forfeit(a, b, f ? a : b),
    );
  const seasonsArb = fc.array(
    fc.record({
      games: fc.array(gameArb, { maxLength: 15 }),
      completed: fc.boolean(),
    }),
    { maxLength: 4 },
  );

  it("matches the standings of every game taken together", () => {
    fc.assert(
      fc.property(seasonsArb, (list) => {
        const seasons = list.map((s, i) =>
          season(`s${i}`, TEAMS, s.games, { completed: s.completed }),
        );
        const together = standings(
          TEAMS,
          list.flatMap((s) => s.games),
          { seed: "all" },
        );
        for (const row of together) {
          const r = allTimeRecordOf(row.teamId, seasons);
          expect([r.played, r.wins, r.losses, r.ties]).toEqual([
            row.played,
            row.wins,
            row.losses,
            row.ties,
          ]);
          expect([r.runsFor, r.runsAgainst, r.runDifference]).toEqual([
            row.runsFor,
            row.runsAgainst,
            row.runDifference,
          ]);
          expect(r.winPct).toBeCloseTo(row.winPct);
        }
      }),
    );
  });

  it("gives one title for each completed season someone played in", () => {
    fc.assert(
      fc.property(seasonsArb, (list) => {
        const seasons = list.map((s, i) =>
          season(`s${i}`, TEAMS, s.games, { completed: s.completed }),
        );
        const titles = allTimeRecords(seasons).reduce(
          (n, r) => n + r.titles,
          0,
        );
        // The coin flip breaks every tie, so a played season has one winner.
        expect(titles).toBe(
          list.filter((s) => s.completed && s.games.length > 0).length,
        );
      }),
    );
  });

  it("orders by titles, then win percentage", () => {
    fc.assert(
      fc.property(seasonsArb, (list) => {
        const records = allTimeRecords(
          list.map((s, i) =>
            season(`s${i}`, TEAMS, s.games, { completed: s.completed }),
          ),
        );
        for (let i = 1; i < records.length; i++) {
          const [a, b] = [records[i - 1], records[i]];
          if (!a || !b) continue;
          expect(
            a.titles > b.titles ||
              (a.titles === b.titles && a.winPct >= b.winPct),
          ).toBe(true);
        }
      }),
    );
  });
});

describe("display helpers", () => {
  it("writes win percentage like the standings", () => {
    expect([pctText(0.75), pctText(1), pctText(0)]).toEqual([
      ".750",
      "1.000",
      ".000",
    ]);
  });

  it("signs a run difference", () => {
    expect([signedText(4), signedText(0), signedText(-3)]).toEqual([
      "+4",
      "0",
      "-3",
    ]);
  });

  it("writes a season's dates, with both years when it spans two", () => {
    expect(seasonDates("2026-04-06", "2026-05-18")).toBe(
      "Apr 6 – May 18, 2026",
    );
    expect(seasonDates("2026-11-30", "2027-01-11")).toBe(
      "Nov 30, 2026 – Jan 11, 2027",
    );
  });
});
