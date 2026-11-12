import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { forfeit, gamesArb, played } from "./games.fixture";
import {
  type LeagueRecord,
  leagueRecords,
  RECORD_TITLES,
  recordsSetIn,
  recordValue,
} from "./records";

const byKey = (records: LeagueRecord[]) =>
  new Map(records.map((r) => [r.key, r]));

describe("league records", () => {
  const games = [
    played("A", 14, "B", 3, 0),
    played("C", 9, "D", 8, 1),
    played("A", 5, "C", 0, 2),
    played("A", 6, "D", 2, 3),
    forfeit("B", "D", "B", 4),
    played("B", 0, "C", 4, 5),
    played("D", 16, "A", 12, 6, { kind: "playoff" }),
  ];
  const records = byKey(leagueRecords(games));

  it("finds the game records, playoffs included", () => {
    expect(records.get("most_runs")).toMatchObject({
      value: 16,
      team: "D",
      opponent: "A",
    });
    expect(records.get("biggest_win")).toMatchObject({
      value: 11,
      team: "A",
      opponent: "B",
    });
    expect(records.get("highest_scoring")).toMatchObject({ value: 28 });
  });

  it("finds the season records from regular games only", () => {
    expect(records.get("longest_win_streak")).toMatchObject({
      value: 3,
      team: "A",
      seasonId: "spring",
    });
    expect(records.get("most_wins_season")).toMatchObject({
      value: 3,
      team: "A",
    });
    expect(records.get("most_shutouts_season")).toMatchObject({
      value: 1,
      team: "A",
      matchedBy: 1,
    });
    expect(records.get("longest_losing_streak")).toMatchObject({
      value: 3,
      team: "B",
    });
  });

  it("dates a season total by the game that reached it", () => {
    const season = byKey(
      leagueRecords([
        played("A", 4, "B", 0, 0),
        played("A", 1, "C", 2, 1),
        played("A", 3, "D", 3, 2),
      ]),
    );
    const firstGame = "g-0-A-B-";
    expect(season.get("most_shutouts_season")?.gameId).toBe(firstGame);
    expect(season.get("most_wins_season")?.gameId).toBe(firstGame);
  });

  it("keeps the first mark when a later one equals it", () => {
    const tied = byKey(
      leagueRecords([played("A", 10, "B", 0, 0), played("C", 10, "D", 0, 1)]),
    );
    expect(tied.get("most_runs")).toMatchObject({ team: "A", matchedBy: 1 });
  });

  it("has no records before any runs or wins", () => {
    expect(leagueRecords([])).toEqual([]);
    const scoreless = byKey(leagueRecords([played("A", 0, "B", 0)]));
    expect(scoreless.has("most_runs")).toBe(false);
    expect(scoreless.has("longest_win_streak")).toBe(false);
  });

  it("words each value with its unit", () => {
    const all = leagueRecords(games);
    expect(all.map(recordValue)).toEqual([
      "16 runs",
      "By 11 runs",
      "28 runs",
      "3 wins in a row",
      "3 wins",
      "1 shutout",
      "3 losses in a row",
    ]);
    for (const r of all) expect(RECORD_TITLES[r.key]).toBeTruthy();
    expect(
      recordValue({ ...(records.get("most_runs") as LeagueRecord), value: 1 }),
    ).toBe("1 run");
  });

  it("picks the records set in given games", () => {
    const all = leagueRecords(games);
    const lastGame = games.at(-1)?.id ?? "";
    expect(recordsSetIn(all, new Set([lastGame])).map((r) => r.key)).toEqual([
      "most_runs",
      "highest_scoring",
    ]);
  });

  describe("properties", () => {
    it("no game beats a game record, and its holder reached it", () => {
      fc.assert(
        fc.property(gamesArb(), (all) => {
          const found = byKey(leagueRecords(all));
          const playedGames = all.flatMap((g) =>
            g.result.kind === "played" ? [{ id: g.id, ...g.result }] : [],
          );
          const most = Math.max(
            0,
            ...playedGames.map((g) => Math.max(g.scoreA, g.scoreB)),
          );
          const margin = Math.max(
            0,
            ...playedGames.map((g) => Math.abs(g.scoreA - g.scoreB)),
          );
          const total = Math.max(
            0,
            ...playedGames.map((g) => g.scoreA + g.scoreB),
          );
          expect(found.get("most_runs")?.value ?? 0).toBe(most);
          expect(found.get("biggest_win")?.value ?? 0).toBe(margin);
          expect(found.get("highest_scoring")?.value ?? 0).toBe(total);
          for (const key of [
            "most_runs",
            "biggest_win",
            "highest_scoring",
          ] as const) {
            const r = found.get(key);
            if (!r) continue;
            const g = playedGames.find((p) => p.id === r.gameId);
            const value =
              key === "most_runs"
                ? Math.max(g?.scoreA ?? -1, g?.scoreB ?? -1)
                : key === "biggest_win"
                  ? Math.abs((g?.scoreA ?? 0) - (g?.scoreB ?? 0))
                  : (g?.scoreA ?? 0) + (g?.scoreB ?? 0);
            expect(value).toBe(r.value);
          }
        }),
      );
    });

    it("a winning streak never exceeds the most wins in a season", () => {
      fc.assert(
        fc.property(gamesArb(), (all) => {
          const found = byKey(leagueRecords(all));
          expect(
            found.get("longest_win_streak")?.value ?? 0,
          ).toBeLessThanOrEqual(found.get("most_wins_season")?.value ?? 0);
          expect(
            found.get("most_shutouts_season")?.value ?? 0,
          ).toBeLessThanOrEqual(found.get("most_wins_season")?.value ?? 0);
        }),
      );
    });
  });
});
