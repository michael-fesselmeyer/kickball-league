import { describe, expect, it } from "vitest";
import { publicGame } from "@/domain/schedule/fixtures";
import { gameEvent, teamFeed } from "./team-feed";
import { problems, unfold } from "./validate";

const origin = "https://example.test";

describe("gameEvent", () => {
  it("makes a stable event with the place, map point and game link", () => {
    const e = gameEvent(publicGame({ versionNo: 4 }), origin);
    expect(e).toEqual({
      uid: "game-00000000-0000-4000-8000-000000000001@kickball-league",
      start: new Date("2026-09-15T00:00:00Z"),
      end: new Date("2026-09-15T00:55:00Z"),
      summary: "Kickers vs Sluggers",
      location: "Field 2, Riverside Park, 1 Park Ave",
      geo: { lat: 40.72, lng: -73.95 },
      description:
        "Fall 2026, round 3\nGame page: https://example.test/games/00000000-0000-4000-8000-000000000001",
      url: "https://example.test/games/00000000-0000-4000-8000-000000000001",
      status: "CONFIRMED",
      sequence: 4,
    });
  });

  it("adds the result once the game is final", () => {
    const e = gameEvent(
      publicGame({ status: "final", scoreA: 7, scoreB: 2, roundNo: null }),
      origin,
    );
    expect(e?.description?.split("\n").slice(0, 2)).toEqual([
      "Fall 2026",
      "Final: Kickers 7, Sluggers 2",
    ]);
  });

  it("marks called-off games cancelled and says so in the title", () => {
    const e = gameEvent(publicGame({ slotCancelled: true }), origin);
    expect(e?.status).toBe("CANCELLED");
    expect(e?.summary).toBe("Rained out: Kickers vs Sluggers");
    expect(e?.description).toContain("Check the game page for a makeup date.");
  });

  it("skips games with no slot and leaves out unknown places", () => {
    expect(
      gameEvent(publicGame({ startsAt: null, endsAt: null }), origin),
    ).toBeNull();
    const e = gameEvent(publicGame({ field: null, venue: null }), origin);
    expect(e?.location).toBeUndefined();
    expect(e?.geo).toBeUndefined();
  });
});

describe("teamFeed", () => {
  it("is a valid calendar with one event per placed game", () => {
    const ics = teamFeed({
      teamName: "Kickers",
      timeZone: "America/New_York",
      origin,
      now: new Date("2026-09-01T12:00:00Z"),
      games: [
        publicGame(),
        publicGame({
          id: "00000000-0000-4000-8000-000000000002",
          startsAt: new Date("2026-11-03T01:00:00Z"), // after the clocks change
          endsAt: new Date("2026-11-03T01:55:00Z"),
        }),
        publicGame({ id: "unplaced", startsAt: null, endsAt: null }),
      ],
    });
    expect(problems(ics)).toEqual([]);
    const lines = unfold(ics);
    expect(lines).toContain("X-WR-CALNAME:Kickers games");
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(2);
    // Both games kick off at 8 pm local, on either side of daylight saving.
    expect(lines.filter((l) => l.startsWith("DTSTART;"))).toEqual([
      "DTSTART;TZID=America/New_York:20260914T200000",
      "DTSTART;TZID=America/New_York:20261102T200000",
    ]);
  });
});
