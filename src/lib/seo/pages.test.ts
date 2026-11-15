import { describe, expect, it } from "vitest";
import type { PublicGame } from "@/domain/schedule/public-game";
import { gamePageJsonLd, teamPageJsonLd } from "./pages";

const ORIGIN = "https://league.example.test";

const game = (over: Partial<PublicGame> = {}): PublicGame => ({
  id: "g1",
  seasonId: "s1",
  seasonName: "Fall 2026",
  seasonSlug: "fall-2026",
  versionNo: 1,
  roundNo: 1,
  kind: "regular",
  status: "scheduled",
  startsAt: new Date("2026-09-15T23:00:00Z"),
  endsAt: new Date("2026-09-15T23:55:00Z"),
  slotCancelled: false,
  field: "Field 2",
  venue: null,
  teamA: { id: "a", name: "Aces", slug: "aces", colorHex: null },
  teamB: { id: "b", name: "Bees", slug: "bees", colorHex: null },
  scoreA: null,
  scoreB: null,
  forfeitBy: null,
  ruled: false,
  ...over,
});

describe("teamPageJsonLd", () => {
  it("names the team at its page, as a member of the league", () => {
    expect(
      teamPageJsonLd(ORIGIN, { name: "Aces", slug: "aces" }),
    ).toMatchObject({
      "@context": "https://schema.org",
      "@type": "SportsTeam",
      name: "Aces",
      url: `${ORIGIN}/teams/aces`,
      memberOf: { "@id": `${ORIGIN}/#league` },
    });
  });
});

describe("gamePageJsonLd", () => {
  it("describes an upcoming game between both teams at the park", () => {
    const data = gamePageJsonLd(ORIGIN, game());
    expect(data).toMatchObject({
      "@type": "SportsEvent",
      name: "Aces vs Bees",
      url: `${ORIGIN}/games/g1`,
      startDate: "2026-09-15T23:00:00.000Z",
      endDate: "2026-09-15T23:55:00.000Z",
      eventStatus: "https://schema.org/EventScheduled",
      location: { name: "McCarren Park, Field 2" },
      competitor: [
        { "@type": "SportsTeam", url: `${ORIGIN}/teams/aces` },
        { "@type": "SportsTeam", url: `${ORIGIN}/teams/bees` },
      ],
    });
    expect(data).not.toHaveProperty("description");
  });

  it("carries a final's result", () => {
    const data = gamePageJsonLd(
      ORIGIN,
      game({ status: "final", scoreA: 7, scoreB: 4 }),
    );
    expect(data["description"]).toEqual(expect.stringContaining("7"));
  });

  it("reads a rained-out game waiting for a makeup as postponed", () => {
    expect(
      gamePageJsonLd(ORIGIN, game({ slotCancelled: true }))["eventStatus"],
    ).toBe("https://schema.org/EventPostponed");
  });
});
