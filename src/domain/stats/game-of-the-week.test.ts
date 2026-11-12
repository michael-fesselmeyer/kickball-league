import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { at, gamesArb, played, TEAMS } from "./games.fixture";
import {
  gameOfTheWeek,
  type Matchup,
  nextGameDay,
  pickBlurb,
  type PickReason,
} from "./game-of-the-week";
import { type PowerRow, powerRankings } from "./power";

const row = (team: string, rank: number, score: number): PowerRow => ({
  team,
  rank,
  score,
  played: 3,
  record: score,
  form: score,
  margin: score,
  schedule: score,
});

const match = (gameId: string, teamA: string, teamB: string, day = 10) => ({
  gameId,
  teamA,
  teamB,
  startsAt: at(day),
});

const power = [
  row("A", 1, 0.9),
  row("B", 2, 0.85),
  row("C", 3, 0.6),
  row("D", 4, 0.58),
  row("E", 5, 0.2),
  row("F", 6, 0.1),
];

describe("game of the week", () => {
  it("picks the clash at the top", () => {
    const pick = gameOfTheWeek(
      [match("g1", "C", "D"), match("g2", "A", "B"), match("g3", "E", "F")],
      power,
      [],
    );
    expect(pick).toMatchObject({ gameId: "g2", reason: "top_clash" });
  });

  it("calls out a rematch of a tight game", () => {
    const pick = gameOfTheWeek(
      [match("g1", "C", "D"), match("g2", "A", "F")],
      power,
      [played("D", 4, "C", 3, 0)],
    );
    expect(pick).toMatchObject({ gameId: "g1", reason: "close_rematch" });
  });

  it("calls out evenly matched teams and otherwise the best available", () => {
    expect(gameOfTheWeek([match("g1", "C", "D")], power, [])?.reason).toBe(
      "evenly_matched",
    );
    expect(gameOfTheWeek([match("g1", "A", "F")], power, [])?.reason).toBe(
      "best_available",
    );
  });

  it("treats unranked teams as middle of the pack", () => {
    expect(gameOfTheWeek([match("g1", "X", "Y")], power, [])?.reason).toBe(
      "evenly_matched",
    );
  });

  it("has nothing to pick from an empty week", () => {
    expect(gameOfTheWeek([], power, [])).toBeNull();
  });

  it("explains every pick", () => {
    const reasons: PickReason[] = [
      "top_clash",
      "close_rematch",
      "evenly_matched",
      "best_available",
    ];
    for (const r of reasons) {
      const blurb = pickBlurb(r, "Kickers", "Sluggers");
      expect(blurb).toContain("Kickers");
      expect(blurb).toContain("Sluggers");
    }
  });

  it("finds the next game day's games", () => {
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const all = [
      match("old", "A", "B", 1),
      match("n1", "A", "C", 8),
      match("n2", "B", "D", 8),
      match("later", "E", "F", 15),
    ];
    expect(nextGameDay(all, at(5), day).map((m) => m.gameId)).toEqual([
      "n1",
      "n2",
    ]);
    expect(nextGameDay(all, at(20), day)).toEqual([]);
  });

  describe("properties", () => {
    const matchupsArb = fc
      .array(
        fc
          .tuple(fc.constantFrom(...TEAMS), fc.constantFrom(...TEAMS))
          .filter(([a, b]) => a !== b),
        { maxLength: 6 },
      )
      .map((pairs) =>
        pairs.map(([a, b], i): Matchup => match(`m${i}`, a, b, 30 + (i % 2))),
      );

    it("picks one of the week's games, whatever their order", () => {
      fc.assert(
        fc.property(
          gamesArb(),
          matchupsArb.chain((m) =>
            fc.tuple(
              fc.constant(m),
              fc.shuffledSubarray(m, {
                minLength: m.length,
                maxLength: m.length,
              }),
            ),
          ),
          (history, [matchups, shuffled]) => {
            const ranks = powerRankings(TEAMS, history);
            const pick = gameOfTheWeek(matchups, ranks, history);
            if (matchups.length === 0) expect(pick).toBeNull();
            else expect(matchups.map((m) => m.gameId)).toContain(pick?.gameId);
            expect(gameOfTheWeek(shuffled, ranks, history)).toEqual(pick);
          },
        ),
      );
    });
  });
});
