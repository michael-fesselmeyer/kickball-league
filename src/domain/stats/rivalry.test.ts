import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { forfeit, gamesArb, played, TEAMS } from "./games.fixture";
import { rivalriesOf, rivalry, seriesLine } from "./rivalry";

const name = (t: string) => ({ A: "Kickers", B: "Sluggers" })[t] ?? t;

describe("rivalry", () => {
  const games = [
    played("A", 5, "B", 3, 0),
    played("B", 12, "A", 1, 1),
    played("A", 4, "C", 0, 2),
    played("A", 6, "B", 6, 3),
    forfeit("B", "A", "B", 4),
    played("A", 7, "B", 6, 5),
  ];

  it("totals the series between two teams only", () => {
    const r = rivalry("A", "B", games);
    expect(r).toMatchObject({
      meetings: 5,
      winsX: 3,
      winsY: 1,
      ties: 1,
      runsX: 19,
      runsY: 27,
      streak: { team: "A", length: 2 },
      biggestWin: { team: "B", margin: 11 },
    });
    expect(r.history.map((m) => m.winner)).toEqual(["A", "A", null, "B", "A"]);
    expect(r.history[1]).toMatchObject({ runsX: null, runsY: null });
  });

  it("has no streak after a tie or before any meeting", () => {
    expect(rivalry("A", "B", games.slice(0, 4)).streak).toBeNull();
    const none = rivalry("A", "D", games);
    expect(none.meetings).toBe(0);
    expect(none.streak).toBeNull();
    expect(none.biggestWin).toBeNull();
  });

  it("keeps the first biggest win when one matches it", () => {
    const r = rivalry("A", "B", [
      played("A", 5, "B", 0, 0),
      played("B", 5, "A", 0, 1),
    ]);
    expect(r.biggestWin?.team).toBe("A");
  });

  it("words the series", () => {
    expect(seriesLine(rivalry("A", "B", games), name)).toBe(
      "Kickers lead the series 3–1–1",
    );
    expect(seriesLine(rivalry("B", "A", games), name)).toBe(
      "Kickers lead the series 3–1–1",
    );
    expect(seriesLine(rivalry("A", "B", games.slice(0, 2)), name)).toBe(
      "Series tied 1–1",
    );
    expect(seriesLine(rivalry("A", "B", games.slice(0, 1)), name)).toBe(
      "Kickers lead the series 1–0",
    );
    expect(seriesLine(rivalry("A", "D", games), name)).toBe("First meeting");
  });

  it("lists a team's opponents, most meetings first", () => {
    expect(rivalriesOf("A", games).map((r) => [r.y, r.meetings])).toEqual([
      ["B", 5],
      ["C", 1],
    ]);
  });

  describe("properties", () => {
    const pair = fc
      .tuple(fc.constantFrom(...TEAMS), fc.constantFrom(...TEAMS))
      .filter(([x, y]) => x !== y);

    it("adds up: wins plus ties are the meetings", () => {
      fc.assert(
        fc.property(gamesArb(), pair, (all, [x, y]) => {
          const r = rivalry(x, y, all);
          const between = all.filter(
            (g) =>
              (g.teamA === x && g.teamB === y) ||
              (g.teamA === y && g.teamB === x),
          );
          expect(r.meetings).toBe(between.length);
          expect(r.winsX + r.winsY + r.ties).toBe(r.meetings);
          expect(r.history).toHaveLength(r.meetings);
          if (r.streak) expect(r.streak.length).toBeLessThanOrEqual(r.meetings);
        }),
      );
    });

    it("is the same series seen from either side", () => {
      fc.assert(
        fc.property(gamesArb(), pair, (all, [x, y]) => {
          const xy = rivalry(x, y, all);
          const yx = rivalry(y, x, all);
          expect([yx.winsX, yx.winsY, yx.ties]).toEqual([
            xy.winsY,
            xy.winsX,
            xy.ties,
          ]);
          expect([yx.runsX, yx.runsY]).toEqual([xy.runsY, xy.runsX]);
          expect(yx.streak).toEqual(xy.streak);
          expect(yx.biggestWin).toEqual(xy.biggestWin);
        }),
      );
    });
  });
});
