import { describe, expect, it } from "vitest";
import type { PublicGame } from "../schedule/public-game";
import {
  announcementShareText,
  bold,
  eventShareText,
  gameShareText,
  rainoutShareText,
  teamShareText,
  whatsappHref,
} from "./share-text";

const tz = "America/New_York";
const url = "https://league.example.test/games/g1";

const base: PublicGame = {
  id: "g1",
  seasonId: "s1",
  seasonName: "Fall 2026",
  seasonSlug: "fall-2026",
  versionNo: 1,
  roundNo: 1,
  kind: "regular",
  status: "scheduled",
  startsAt: new Date("2026-11-15T18:00:00Z"),
  endsAt: new Date("2026-11-15T19:00:00Z"),
  slotCancelled: false,
  field: "Field 2",
  venue: {
    name: "Riverside Park",
    slug: "riverside",
    address: null,
    lat: null,
    lng: null,
  },
  teamA: { id: "a", name: "Sluggers", slug: "sluggers", colorHex: null },
  teamB: { id: "b", name: "Kickers", slug: "kickers", colorHex: null },
  scoreA: null,
  scoreB: null,
  forfeitBy: null,
};

describe("bold and whatsappHref", () => {
  it("wraps in asterisks and drops any inside", () => {
    expect(bold(" Star*s ")).toBe("*Stars*");
  });
  it("encodes the whole message into a wa.me link", () => {
    expect(whatsappHref("A & B\nhi")).toBe(
      "https://wa.me/?text=A%20%26%20B%0Ahi",
    );
  });
});

describe("gameShareText", () => {
  it("leads with the winner on a final", () => {
    const text = gameShareText(
      { ...base, status: "final", scoreA: 3, scoreB: 5 },
      { url, timeZone: tz },
    );
    expect(text).toBe(`Final: *Kickers 5, Sluggers 3*\nSun, Nov 15\n${url}`);
  });

  it("names the forfeit winner", () => {
    const text = gameShareText(
      { ...base, status: "forfeit", forfeitBy: "a" },
      { url, timeZone: tz },
    );
    expect(text.split("\n")[0]).toBe("Forfeit: *Kickers win by forfeit*");
  });

  it("says a rained-out game is off and a makeup is coming", () => {
    const text = gameShareText(
      { ...base, slotCancelled: true },
      { url, timeZone: tz },
    );
    expect(text).toContain(
      "Rained out: *Sluggers vs Kickers* (Sun, Nov 15, 1:00 PM) is off.",
    );
    expect(text).toContain("makeup");
    expect(text.endsWith(url)).toBe(true);
  });

  it("gives time and place for a game still to play", () => {
    expect(gameShareText(base, { url, timeZone: tz })).toBe(
      `Game on: *Sluggers vs Kickers*\nSun, Nov 15, 1:00 PM\nField 2, Riverside Park\n${url}`,
    );
  });

  it("says when a makeup has no time yet", () => {
    const text = gameShareText(
      { ...base, startsAt: null, endsAt: null, field: null, venue: null },
      { url, timeZone: tz },
    );
    expect(text).toBe(
      `Game on: *Sluggers vs Kickers*\nTime to be announced\n${url}`,
    );
  });

  it("flags a live game", () => {
    const text = gameShareText(
      { ...base, status: "in_progress" },
      { url, timeZone: tz },
    );
    expect(text.split("\n")[0]).toBe("Live now: *Sluggers vs Kickers*");
  });
});

describe("teamShareText", () => {
  it("includes the record once games are played", () => {
    expect(
      teamShareText({
        name: "Sluggers",
        seasonName: "Fall 2026",
        record: { wins: 4, losses: 1, ties: 1 },
        url: "https://league.example.test/teams/sluggers",
      }),
    ).toBe(
      "*Sluggers* · Fall 2026 · 4-1-1\nSchedule, results and a calendar feed:\nhttps://league.example.test/teams/sluggers",
    );
  });
  it("leaves out an empty record and a missing season", () => {
    expect(
      teamShareText({
        name: "Sluggers",
        seasonName: null,
        record: { wins: 0, losses: 0, ties: 0 },
        url: "u",
      }).split("\n")[0],
    ).toBe("*Sluggers*");
  });
});

describe("rainoutShareText", () => {
  it("lists each makeup, or that one is coming", () => {
    expect(
      rainoutShareText({
        day: "Sun, Nov 15",
        moves: [
          {
            teams: "Sluggers vs Kickers",
            makeup: "Sun, Nov 22, 1:00 PM, Field 2",
          },
          { teams: "Aces vs Bees", makeup: null },
        ],
        url: "https://league.example.test/seasons/fall-2026/schedule",
      }),
    ).toBe(
      [
        "Rain-out: games on *Sun, Nov 15* are off.",
        "",
        "Makeups:",
        "• Sluggers vs Kickers: Sun, Nov 22, 1:00 PM, Field 2",
        "• Aces vs Bees: new time to come",
        "",
        "Full schedule: https://league.example.test/seasons/fall-2026/schedule",
      ].join("\n"),
    );
  });
  it("skips the makeup list when nothing moved", () => {
    expect(
      rainoutShareText({ day: "Sun, Nov 15", moves: [], url: "u" }),
    ).not.toContain("Makeups");
  });
});

describe("announcementShareText", () => {
  it("bolds the subject and adds the link when given", () => {
    expect(
      announcementShareText({
        subject: "Jerseys are in",
        body: "Pick them up Sunday.\n",
        url: "u",
      }),
    ).toBe("*Jerseys are in*\n\nPick them up Sunday.\n\nu");
    expect(announcementShareText({ subject: "Hi", body: "There" })).toBe(
      "*Hi*\n\nThere",
    );
  });
});

describe("eventShareText", () => {
  const event = {
    title: "Spring *prom*",
    kind: "Party",
    when: "Sat, Mar 6, 8:00 – 11:00 PM",
    place: "The Example Ballroom, 1 Example St",
    audience: "Sun Kickers and Foul Play, Fall 2026",
    invite: {
      host: "partiful.example.test",
      url: "https://partiful.example.test/e/prom",
    },
    url: "https://league.example.test/app/events/spring-prom-2027-03-06",
    cancelled: false,
  };

  it("lists when, where, who it's for, the invite and the page", () => {
    expect(eventShareText(event)).toBe(
      [
        "*Spring prom* · Party",
        "Sat, Mar 6, 8:00 – 11:00 PM",
        "The Example Ballroom, 1 Example St",
        "For Sun Kickers and Foul Play, Fall 2026",
        "RSVP on partiful.example.test: https://partiful.example.test/e/prom",
        "https://league.example.test/app/events/spring-prom-2027-03-06",
      ].join("\n"),
    );
  });

  it("leaves out what a public event without a place or link doesn't have", () => {
    expect(
      eventShareText({ ...event, place: null, audience: null, invite: null }),
    ).toBe(
      "*Spring prom* · Party\nSat, Mar 6, 8:00 – 11:00 PM\nhttps://league.example.test/app/events/spring-prom-2027-03-06",
    );
  });

  it("says plainly when the event is called off", () => {
    expect(eventShareText({ ...event, cancelled: true })).toBe(
      "Called off: *Spring prom* (Sat, Mar 6, 8:00 – 11:00 PM)\nhttps://league.example.test/app/events/spring-prom-2027-03-06",
    );
  });
});
