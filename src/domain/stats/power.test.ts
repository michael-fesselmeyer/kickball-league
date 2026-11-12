import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { forfeit, gamesArb, played, TEAMS } from "./games.fixture";
import type { StatGame } from "./games";
import {
  movementLabel,
  movementWords,
  POWER_WEIGHTS,
  powerRankings,
  powerRankingsWithMovement,
} from "./power";

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

describe("power rankings", () => {
  it("weighs record, form, margin and schedule", () => {
    const games = [
      played("A", 10, "B", 0, 0),
      played("A", 2, "C", 4, 1),
      played("B", 5, "C", 5, 2),
    ];
    const rows = powerRankings(["A", "B", "C"], games);
    const a = rows.find((r) => r.team === "A");
    expect(a).toMatchObject({ played: 2, record: 0.5, form: 0.5 });
    // Diffs +10 and -2 average +4, scaled from -10..10 to 0..1.
    expect(a?.margin).toBeCloseTo(0.7);
    // B is 0.25 (one tie in two), C is 0.75.
    expect(a?.schedule).toBeCloseTo(0.5);
    expect(a?.score).toBeCloseTo(
      POWER_WEIGHTS.record * 0.5 +
        POWER_WEIGHTS.form * 0.5 +
        POWER_WEIGHTS.margin * 0.7 +
        POWER_WEIGHTS.schedule * 0.5,
    );
    expect(rows.map((r) => r.team)).toEqual(["C", "A", "B"]);
  });

  it("leaves out teams that have not played", () => {
    expect(
      powerRankings(["A", "B", "Z"], [played("A", 1, "B", 0)]).map(
        (r) => r.team,
      ),
    ).toEqual(["A", "B"]);
  });

  it("counts form over the last three games only", () => {
    const games = [
      played("A", 0, "B", 5, 0),
      played("A", 5, "B", 0, 1),
      played("A", 5, "B", 0, 2),
      played("A", 5, "B", 0, 3),
    ];
    expect(powerRankings(["A"], games)[0]?.form).toBe(1);
  });

  it("gives a team with only forfeits a neutral margin", () => {
    const [row] = powerRankings(["A"], [forfeit("A", "B", "B")]);
    expect(row?.margin).toBe(0.5);
    expect(row?.record).toBe(1);
  });

  it("splits equal scores by the team key", () => {
    const games = [played("B", 3, "A", 3), played("C", 3, "D", 3)];
    expect(
      powerRankings(["D", "C", "B", "A"], games).map((r) => r.team),
    ).toEqual(["A", "B", "C", "D"]);
  });

  it("shows movement since before the latest game day", () => {
    const games = [
      played("A", 5, "B", 0, 0),
      played("C", 1, "D", 0, 0),
      played("B", 9, "C", 0, 1),
      played("D", 6, "A", 5, 1),
    ];
    const rows = powerRankingsWithMovement(["A", "B", "C", "D"], games, dayOf);
    const before = powerRankings(
      ["A", "B", "C", "D"],
      games.filter(
        (g) => dayOf(g.playedAt) < dayOf(games[2]?.playedAt ?? new Date()),
      ),
    );
    for (const r of rows) {
      const was = before.find((b) => b.team === r.team)?.rank ?? null;
      expect(r.previousRank).toBe(was);
      expect(r.movement).toBe(was === null ? null : was - r.rank);
    }
  });

  it("marks teams playing their first game as new", () => {
    const rows = powerRankingsWithMovement(
      ["A", "B"],
      [played("A", 1, "B", 0, 0)],
      dayOf,
    );
    expect(rows.every((r) => r.movement === null)).toBe(true);
    expect(powerRankingsWithMovement(["A"], [], dayOf)).toEqual([]);
  });

  it("words movement for sighted and screen reader users", () => {
    expect(movementLabel(null)).toBe("New");
    expect(movementLabel(2)).toBe("▲2");
    expect(movementLabel(-1)).toBe("▼1");
    expect(movementLabel(0)).toBe("–");
    expect(movementWords(null)).toBe("New this week");
    expect(movementWords(0)).toBe("No change");
    expect(movementWords(1)).toBe("Up 1 place");
    expect(movementWords(-3)).toBe("Down 3 places");
  });

  describe("properties", () => {
    it("rank every team that played exactly once, 1 to n, by score", () => {
      fc.assert(
        fc.property(gamesArb(), (games) => {
          const rows = powerRankings(TEAMS, games);
          const playedTeams = TEAMS.filter((t) =>
            games.some((g) => g.teamA === t || g.teamB === t),
          );
          expect(rows.map((r) => r.team).sort()).toEqual(
            [...playedTeams].sort(),
          );
          rows.forEach((r, i) => {
            expect(r.rank).toBe(i + 1);
            expect(r.score).toBeGreaterThanOrEqual(0);
            expect(r.score).toBeLessThanOrEqual(1);
            for (const part of [r.record, r.form, r.margin, r.schedule]) {
              expect(part).toBeGreaterThanOrEqual(0);
              expect(part).toBeLessThanOrEqual(1);
            }
            const next = rows[i + 1];
            if (next) expect(r.score).toBeGreaterThanOrEqual(next.score);
          });
        }),
      );
    });

    it("do not depend on the order games are passed in", () => {
      fc.assert(
        fc.property(
          gamesArb().chain((games) =>
            fc.tuple(
              fc.constant(games),
              fc.shuffledSubarray(games, {
                minLength: games.length,
                maxLength: games.length,
              }),
            ),
          ),
          ([games, shuffled]) => {
            expect(powerRankings(TEAMS, shuffled)).toEqual(
              powerRankings(TEAMS, games),
            );
          },
        ),
      );
    });

    it("do not depend on what the teams are called", () => {
      const rename = (t: string) => `team-${t.toLowerCase()}`;
      fc.assert(
        fc.property(gamesArb(), (games) => {
          const renamed = games.map((g): StatGame => ({
            ...g,
            teamA: rename(g.teamA),
            teamB: rename(g.teamB),
            result:
              g.result.kind === "forfeit"
                ? { kind: "forfeit", forfeitBy: rename(g.result.forfeitBy) }
                : g.result,
          }));
          const scores = new Map(
            powerRankings(TEAMS, games).map((r) => [rename(r.team), r.score]),
          );
          for (const r of powerRankings(TEAMS.map(rename), renamed))
            expect(r.score).toBeCloseTo(scores.get(r.team) ?? NaN, 12);
        }),
      );
    });

    it("put an unbeaten team above a winless one", () => {
      fc.assert(
        fc.property(gamesArb(), (games) => {
          const rows = powerRankings(TEAMS, games);
          const sides = (t: string) =>
            games
              .filter((g) => g.teamA === t || g.teamB === t)
              .map((g) => {
                if (g.result.kind === "forfeit")
                  return g.result.forfeitBy === t ? "L" : "W";
                const d =
                  (g.teamA === t ? 1 : -1) *
                  (g.result.scoreA - g.result.scoreB);
                return d > 0 ? "W" : d < 0 ? "L" : "T";
              });
          const unbeaten = rows.filter((r) =>
            sides(r.team).every((o) => o === "W"),
          );
          const winless = rows.filter((r) =>
            sides(r.team).every((o) => o === "L"),
          );
          for (const u of unbeaten)
            for (const w of winless) expect(u.rank).toBeLessThan(w.rank);
        }),
      );
    });

    it("never move a team more places than there are teams", () => {
      fc.assert(
        fc.property(gamesArb(), (games) => {
          for (const r of powerRankingsWithMovement(TEAMS, games, dayOf))
            if (r.movement !== null)
              expect(Math.abs(r.movement)).toBeLessThan(TEAMS.length);
        }),
      );
    });
  });
});
