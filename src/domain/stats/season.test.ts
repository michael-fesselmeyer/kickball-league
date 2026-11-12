import { describe, expect, it } from "vitest";
import { publicGame } from "@/domain/schedule/fixtures";
import { matchupsFrom, seasonStats, statGamesFrom, teamsFrom } from "./season";

const pitchSlaps = {
  id: "c",
  name: "Pitch Slaps",
  slug: "pitch-slaps",
  colorHex: null,
};

const schedule = [
  publicGame({
    id: "g1",
    status: "final",
    scoreA: 6,
    scoreB: 2,
    startsAt: new Date("2026-09-08T23:00:00Z"),
  }),
  publicGame({
    id: "g2",
    status: "forfeit",
    forfeitBy: "a",
    teamB: pitchSlaps,
    startsAt: new Date("2026-09-08T23:00:00Z"),
  }),
  publicGame({
    id: "g3",
    kind: "exhibition",
    status: "final",
    scoreA: 1,
    scoreB: 0,
  }),
  publicGame({
    id: "g4",
    status: "final",
    scoreA: 3,
    scoreB: 3,
    startsAt: null,
  }),
  publicGame({
    id: "g5",
    teamA: pitchSlaps,
    startsAt: new Date("2026-09-15T23:00:00Z"),
  }),
  publicGame({
    id: "g6",
    status: "postponed",
    startsAt: new Date("2026-09-15T23:00:00Z"),
  }),
  publicGame({
    id: "g7",
    kind: "playoff",
    status: "final",
    scoreA: 2,
    scoreB: 9,
    startsAt: new Date("2026-09-09T23:00:00Z"),
  }),
];

describe("season stats from the public schedule", () => {
  it("keeps finished, placed, non-exhibition games keyed by team slug", () => {
    const games = statGamesFrom(schedule);
    expect(games.map((g) => g.id)).toEqual(["g1", "g2", "g7"]);
    expect(games[0]).toMatchObject({
      teamA: "kickers",
      teamB: "sluggers",
      result: { kind: "played", scoreA: 6, scoreB: 2 },
    });
    expect(games[1]?.result).toEqual({
      kind: "forfeit",
      forfeitBy: "kickers",
    });
  });

  it("names the forfeiting team B too", () => {
    const [g] = statGamesFrom([
      publicGame({ status: "forfeit", forfeitBy: "b" }),
    ]);
    expect(g?.result).toEqual({ kind: "forfeit", forfeitBy: "sluggers" });
  });

  it("lists the games still to play, not called-off ones", () => {
    expect(matchupsFrom(schedule).map((m) => m.gameId)).toEqual(["g5"]);
  });

  it("indexes teams by slug", () => {
    expect([...teamsFrom(schedule).keys()].sort()).toEqual([
      "kickers",
      "pitch-slaps",
      "sluggers",
    ]);
  });

  it("ranks regular games and picks next week's game", () => {
    const stats = seasonStats(
      schedule,
      ["kickers", "sluggers", "pitch-slaps"],
      "America/New_York",
      new Date("2026-09-10T12:00:00Z"),
    );
    expect(stats.games.map((g) => g.id)).toEqual(["g1", "g2"]);
    expect(stats.power.map((r) => r.team)).toEqual([
      "pitch-slaps",
      "kickers",
      "sluggers",
    ]);
    expect(stats.streaks.get("kickers")?.current).toEqual({
      outcome: "L",
      length: 1,
    });
    expect(stats.pick?.gameId).toBe("g5");
  });

  it("has no pick once the season's games are played", () => {
    const stats = seasonStats(
      schedule,
      ["kickers"],
      "America/New_York",
      new Date("2026-12-01T12:00:00Z"),
    );
    expect(stats.pick).toBeNull();
  });
});
