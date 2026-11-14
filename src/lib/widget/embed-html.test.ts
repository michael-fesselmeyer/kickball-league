import { describe, expect, it } from "vitest";
import { publicGame } from "@/domain/schedule/fixtures";
import {
  leagueWidgetHtml,
  notFoundWidgetHtml,
  teamWidgetHtml,
} from "./embed-html";

const ORIGIN = "https://league.example.test";
const NY = "America/New_York";
const game = publicGame({
  startsAt: new Date("2026-09-15T23:00:00Z"),
  endsAt: new Date("2026-09-15T23:55:00Z"),
});

describe("teamWidgetHtml", () => {
  const html = teamWidgetHtml({
    origin: ORIGIN,
    team: { name: "Kickers", slug: "kickers" },
    entryId: "a",
    seasonSlug: "fall-2026",
    games: [game],
    timeZone: NY,
  });

  it("is a whole page with no script that opens links in a new tab", () => {
    expect(html.startsWith('<!doctype html><html lang="en">')).toBe(true);
    expect(html).toContain("<title>Kickers: next games</title>");
    expect(html).toContain('<base target="_blank">');
    expect(html).not.toMatch(/<script|<link|<img|@import|url\(/i);
  });

  it("lists each game against the opponent, in the league's time zone", () => {
    expect(html).toContain(
      '<time datetime="2026-09-15T23:00:00.000Z">Tue, Sep 15, 7:00 PM</time>',
    );
    expect(html).toContain("vs Sluggers");
    expect(html).toContain("Field 2, Riverside Park, 1 Park Ave");
    expect(html).toContain(
      `href="${ORIGIN}/seasons/fall-2026/schedule/kickers"`,
    );
  });

  it("says so when nothing is scheduled", () => {
    const empty = teamWidgetHtml({
      origin: ORIGIN,
      team: { name: "Kickers", slug: "kickers" },
      entryId: null,
      seasonSlug: null,
      games: [],
      timeZone: NY,
    });
    expect(empty).toContain("No games on the schedule right now.");
    expect(empty).toContain(`href="${ORIGIN}/teams/kickers"`);
  });

  it("escapes names from the database", () => {
    const hostile = teamWidgetHtml({
      origin: ORIGIN,
      team: { name: '<script>alert("x")</script>', slug: "kickers" },
      entryId: "a",
      seasonSlug: "fall-2026",
      games: [
        publicGame({
          ...game,
          teamB: { id: "b", name: "<img src=x>", slug: "b", colorHex: null },
        }),
      ],
      timeZone: NY,
    });
    expect(hostile).not.toContain("<script>");
    expect(hostile).not.toContain("<img");
    expect(hostile).toContain("&lt;script&gt;alert(&quot;x&quot;)");
  });
});

describe("leagueWidgetHtml", () => {
  it("heads the list with the game day and shows both teams", () => {
    const html = leagueWidgetHtml({
      origin: ORIGIN,
      season: { name: "Fall 2026", slug: "fall-2026" },
      day: "2026-09-15",
      games: [game],
      timeZone: NY,
    });
    expect(html).toContain("Next game day: Tuesday, September 15");
    expect(html).toContain("Kickers vs Sluggers");
    expect(html).toContain(">7:00 PM</time>");
    expect(html).toContain(`href="${ORIGIN}/seasons/fall-2026/schedule"`);
  });

  it("works with no season at all", () => {
    const html = leagueWidgetHtml({
      origin: ORIGIN,
      season: null,
      day: null,
      games: [],
      timeZone: NY,
    });
    expect(html).toContain("No games on the schedule right now.");
  });
});

describe("notFoundWidgetHtml", () => {
  it("is a plain page that links home", () => {
    expect(notFoundWidgetHtml(ORIGIN)).toContain(
      "This team isn't on the league's schedule.",
    );
  });
});
