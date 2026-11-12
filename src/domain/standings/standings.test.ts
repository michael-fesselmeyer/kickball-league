import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ResultGame, standings, type Tiebreaker } from "./standings";

const played = (
  teamA: string,
  scoreA: number,
  teamB: string,
  scoreB: number,
): ResultGame => ({ kind: "played", teamA, teamB, scoreA, scoreB });

const order = (
  teams: string[],
  games: ResultGame[],
  tiebreakers?: Tiebreaker[],
) =>
  standings(teams, games, {
    seed: "spring-2027",
    ...(tiebreakers ? { tiebreakers } : {}),
  }).map((r) => `${r.rank}:${r.teamId}:${r.separatedBy ?? "-"}`);

describe("standings", () => {
  it("counts wins, losses, ties, runs and a tie as half a win", () => {
    const rows = standings(
      ["A", "B", "C"],
      [played("A", 5, "B", 3), played("B", 4, "C", 4), played("C", 2, "A", 6)],
      { seed: "s" },
    );
    expect(
      rows.map((r) => [
        r.teamId,
        r.played,
        r.wins,
        r.losses,
        r.ties,
        r.winPct,
        r.runsFor,
        r.runsAgainst,
        r.runDifference,
      ]),
    ).toEqual([
      ["A", 2, 2, 0, 0, 1, 11, 5, 6],
      ["B", 2, 0, 1, 1, 0.25, 7, 9, -2],
      ["C", 2, 0, 1, 1, 0.25, 6, 10, -4],
    ]);
  });

  it("caps run difference at 10 a game", () => {
    const [a, b] = standings(["A", "B"], [played("A", 25, "B", 0)], {
      seed: "s",
    });
    expect([a?.runDifference, b?.runDifference]).toEqual([10, -10]);
    expect([a?.runsFor, b?.runsAgainst]).toEqual([25, 25]);
  });

  it("counts a forfeit as a win and a loss with no runs", () => {
    const rows = standings(
      ["A", "B"],
      [{ kind: "forfeit", teamA: "A", teamB: "B", forfeitBy: "A" }],
      { seed: "s" },
    );
    expect(rows.map((r) => [r.teamId, r.wins, r.losses, r.runsFor])).toEqual([
      ["B", 1, 0, 0],
      ["A", 0, 1, 0],
    ]);
  });

  it("counts a forfeit by either side", () => {
    const rows = standings(
      ["A", "B"],
      [{ kind: "forfeit", teamA: "A", teamB: "B", forfeitBy: "B" }],
      { seed: "s" },
    );
    expect(rows.map((r) => [r.teamId, r.wins, r.losses])).toEqual([
      ["A", 1, 0],
      ["B", 0, 1],
    ]);
  });

  it("tracks the streak and the last five, oldest first", () => {
    const games = [
      played("A", 1, "B", 0),
      played("A", 0, "C", 1),
      played("A", 2, "D", 2),
      played("A", 3, "E", 1),
      played("A", 4, "F", 1),
      played("A", 5, "G", 1),
    ];
    const [a] = standings(["A"], games, { seed: "s" });
    expect([a?.streak, a?.lastFive]).toEqual(["W3", "LTWWW"]);
    const [fresh] = standings(["Z"], [], { seed: "s" });
    expect([fresh?.streak, fresh?.lastFive, fresh?.winPct]).toEqual([
      "",
      "",
      0,
    ]);
  });

  // One case per tiebreaker: the teams level on everything before it.
  it.each<[string, string[], ResultGame[], Tiebreaker[] | undefined, string[]]>(
    [
      [
        "win percentage",
        ["A", "B"],
        [played("A", 2, "B", 1)],
        undefined,
        ["1:A:-", "2:B:win_pct"],
      ],
      [
        "head-to-head among the tied teams",
        ["A", "B", "C", "D"],
        // A and B are both 1-1, and A beat B.
        [
          played("A", 3, "B", 2),
          played("C", 4, "A", 1),
          played("B", 5, "D", 0),
        ],
        undefined,
        ["1:C:-", "2:A:win_pct", "3:B:head_to_head", "4:D:win_pct"],
      ],
      [
        "run difference when head-to-head is level",
        ["A", "B", "C", "D"],
        // A and B tie each other, then win by different margins; C and D never
        // met, and D lost by less.
        [
          played("A", 2, "B", 2),
          played("A", 8, "C", 1),
          played("B", 3, "D", 1),
        ],
        undefined,
        ["1:A:-", "2:B:run_difference", "3:D:win_pct", "4:C:run_difference"],
      ],
      [
        "runs allowed when run difference is level",
        ["A", "B", "C", "D"],
        [played("A", 5, "C", 2), played("B", 9, "D", 6)],
        ["runs_allowed"],
        ["1:A:-", "2:B:runs_allowed", "3:C:win_pct", "4:D:runs_allowed"],
      ],
    ],
  )("breaks ties by %s", (_, teams, games, tiebreakers, expected) => {
    expect(order(teams, games, tiebreakers)).toEqual(expected);
  });

  it("settles a full tie by a coin flip that is the same every time", () => {
    const first = order(["A", "B", "C"], []);
    expect(first.slice(1).every((r) => r.endsWith(":coin_flip"))).toBe(true);
    expect(order(["C", "A", "B"], [])).toEqual(first);
    // A different season flips differently, at least sometimes.
    const flips = new Set(
      ["s1", "s2", "s3", "s4", "s5", "s6"].map((seed) =>
        standings(["A", "B", "C"], [], { seed })
          .map((r) => r.teamId)
          .join(""),
      ),
    );
    expect(flips.size).toBeGreaterThan(1);
  });

  it("shares a rank when no tiebreaker separates teams", () => {
    expect(order(["B", "A"], [], ["runs_allowed"])).toEqual(["1:A:-", "1:B:-"]);
  });

  it("ignores games for teams it was not asked about", () => {
    expect(
      standings(["A"], [played("A", 1, "X", 0)], { seed: "s" })[0]?.wins,
    ).toBe(1);
  });
});

describe("standings properties", () => {
  const teamIds = ["A", "B", "C", "D", "E", "F"];
  const game = fc
    .tuple(
      fc.constantFrom(...teamIds),
      fc.constantFrom(...teamIds),
      fc.nat(15),
      fc.nat(15),
    )
    .filter(([a, b]) => a !== b)
    .map(([a, b, x, y]) => played(a, x, b, y));

  it("ranks every team once, in win-percentage order, whatever the input order", () => {
    fc.assert(
      fc.property(fc.array(game, { maxLength: 30 }), (games) => {
        const rows = standings(teamIds, games, { seed: "p" });
        expect(rows.map((r) => r.teamId).sort()).toEqual(teamIds);
        for (let i = 1; i < rows.length; i++)
          expect(rows[i - 1]?.winPct ?? 0).toBeGreaterThanOrEqual(
            rows[i]?.winPct ?? 0,
          );
        const shuffled = standings([...teamIds].reverse(), games, {
          seed: "p",
        });
        expect(shuffled).toEqual(rows);
        const total = rows.reduce((n, r) => n + r.wins + r.losses + r.ties, 0);
        expect(total).toBe(games.length * 2);
        expect(rows.reduce((n, r) => n + r.runDifference, 0)).toBe(0);
      }),
    );
  });
});
