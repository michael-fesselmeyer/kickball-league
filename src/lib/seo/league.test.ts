import { describe, expect, it } from "vitest";
import { homeParkInfo, leagueInfo } from "./league";
import { gameJsonLd, leagueJsonLd, teamJsonLd } from "./structured-data";

const ORIGIN = "https://league.example.test";

describe("leagueInfo", () => {
  it("describes this deployment's league at its own address", () => {
    expect(leagueInfo(ORIGIN)).toMatchObject({
      name: "Kickball League",
      url: ORIGIN,
      sport: "Kickball",
      areaServed: ["Brooklyn", "New York City"],
      park: { name: "McCarren Park", url: `${ORIGIN}/parks/mccarren-park` },
    });
  });

  it("gives team and game pages the same league to point at", () => {
    const league = leagueInfo(ORIGIN);
    const team = { name: "Sunday Sluggers", url: `${ORIGIN}/teams/a` };
    const other = { name: "Red Rubber Kickers", url: `${ORIGIN}/teams/b` };
    const id = leagueJsonLd(league)["@id"];
    expect(teamJsonLd(team, league)).toMatchObject({ memberOf: { "@id": id } });
    expect(
      gameJsonLd(
        {
          url: `${ORIGIN}/games/1`,
          status: "scheduled",
          startsAt: new Date("2027-07-11T18:00:00Z"),
          teams: [team, other],
          park: homeParkInfo(ORIGIN),
        },
        league,
      ),
    ).toMatchObject({ organizer: { "@id": id } });
  });
});

describe("homeParkInfo", () => {
  it("carries the park's address, coordinates and a map link", () => {
    const park = homeParkInfo(ORIGIN);
    expect(park.address.addressLocality).toBe("Brooklyn");
    expect(park.geo).toEqual({ latitude: 40.7206, longitude: -73.9513 });
    expect(park.mapUrl).toMatch(/^https:\/\/www\.openstreetmap\.org\//);
  });
});
