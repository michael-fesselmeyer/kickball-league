import { describe, expect, it } from "vitest";
import { publicGame } from "@/domain/schedule/fixtures";
import { statGamesFrom } from "./season";
import { gameDays, recapDraft } from "./weekly";

const TZ = "America/New_York";
const cats = {
  id: "c",
  name: "Pitch Slaps",
  slug: "pitch-slaps",
  colorHex: null,
};
const dogs = {
  id: "d",
  name: "Base Invaders",
  slug: "base-invaders",
  colorHex: null,
};

const schedule = [
  // Monday, September 7 (evening, New York time).
  publicGame({
    id: "w1a",
    status: "final",
    scoreA: 6,
    scoreB: 2,
    startsAt: new Date("2026-09-07T23:00:00Z"),
  }),
  publicGame({
    id: "w1b",
    teamA: cats,
    teamB: dogs,
    status: "final",
    scoreA: 3,
    scoreB: 4,
    startsAt: new Date("2026-09-08T00:00:00Z"),
  }),
  // Monday, September 14.
  publicGame({
    id: "w2a",
    teamB: cats,
    status: "final",
    scoreA: 15,
    scoreB: 1,
    startsAt: new Date("2026-09-14T23:00:00Z"),
  }),
  publicGame({
    id: "w2b",
    teamA: { id: "b", name: "Sluggers", slug: "sluggers", colorHex: null },
    teamB: dogs,
    status: "forfeit",
    forfeitBy: "d",
    startsAt: new Date("2026-09-15T00:00:00Z"),
  }),
  // Monday, September 21: still to play.
  publicGame({
    id: "w3a",
    teamB: dogs,
    startsAt: new Date("2026-09-21T23:00:00Z"),
  }),
  publicGame({
    id: "w3b",
    teamA: cats,
    startsAt: new Date("2026-09-22T00:00:00Z"),
  }),
];

describe("weekly recap draft", () => {
  it("lists game days with results, newest first, in local time", () => {
    expect(gameDays(schedule, TZ)).toEqual(["2026-09-14", "2026-09-07"]);
    expect(gameDays([], TZ)).toEqual([]);
  });

  it("drafts the chosen day with what comes next", () => {
    const recap = recapDraft({
      seasonName: "Fall 2026",
      schedule,
      history: statGamesFrom(schedule),
      day: "2026-09-14",
      timeZone: TZ,
      link: "https://league.example.test/seasons/fall-2026/standings",
    });
    expect(recap.subject).toBe("Fall 2026 recap: Monday, September 14");
    expect(recap.body).toContain("Kickers");
    expect(recap.body).toContain("15–1");
    expect(recap.body).toContain(
      "Sluggers took the win by forfeit over Base Invaders.",
    );
    expect(recap.body).not.toContain("6–2");
    expect(recap.body).toContain("New league records\n- Most runs in a game");
    expect(recap.body).toContain("Game of the week\n");
    expect(recap.body).toContain("Monday, September 21, 2026");
  });

  it("leaves out next week when nothing is scheduled after the day", () => {
    const recap = recapDraft({
      seasonName: "Fall 2026",
      schedule: schedule.slice(0, 4),
      history: [],
      day: "2026-09-07",
      timeZone: TZ,
      link: null,
    });
    expect(recap.body).toContain("Pitch Slaps");
    expect(recap.body).not.toContain("Game of the week");
    expect(recap.body).not.toContain("15–1");
  });
});
