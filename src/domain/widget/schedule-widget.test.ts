import { describe, expect, it } from "vitest";
import { publicGame } from "../schedule/fixtures";
import {
  LEAGUE_WIDGET_GAMES,
  nextGameDay,
  upcomingGames,
  widgetSeason,
  widgetSnippet,
} from "./schedule-widget";

const NY = "America/New_York";

/** A game an hour long, starting at `iso`. */
const at = (id: string, iso: string, extra = {}) => {
  const startsAt = new Date(iso);
  return publicGame({
    id,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 55 * 60_000),
    ...extra,
  });
};

describe("upcomingGames", () => {
  const now = new Date("2026-09-15T23:30:00Z");

  it("lists games still to play in kickoff order, up to the limit", () => {
    const games = [
      at("later", "2026-09-22T23:00:00Z"),
      at("playing", "2026-09-15T23:00:00Z"),
      at("past", "2026-09-08T23:00:00Z"),
      at("next", "2026-09-17T23:00:00Z"),
    ];
    expect(upcomingGames(games, now, 2).map((g) => g.id)).toEqual([
      "playing",
      "next",
    ]);
  });

  it("leaves out results, called-off games and makeups with no slot", () => {
    const games = [
      at("final", "2026-09-15T23:00:00Z", {
        status: "final",
        scoreA: 1,
        scoreB: 0,
      }),
      at("rained", "2026-09-16T23:00:00Z", { slotCancelled: true }),
      at("postponed", "2026-09-17T23:00:00Z", { status: "postponed" }),
      publicGame({ id: "makeup", startsAt: null, endsAt: null }),
      at("ok", "2026-09-18T23:00:00Z"),
    ];
    expect(upcomingGames(games, now, 5).map((g) => g.id)).toEqual(["ok"]);
  });
});

describe("nextGameDay", () => {
  it("takes every game on the first local date with one, in kickoff order", () => {
    const now = new Date("2026-09-14T12:00:00Z");
    const games = [
      // 8 pm and 7 pm on Tuesday the 15th in New York (the next UTC day).
      at("tue-late", "2026-09-16T00:00:00Z"),
      at("tue-early", "2026-09-15T23:00:00Z"),
      at("thu", "2026-09-17T23:00:00Z"),
    ];
    expect(nextGameDay(games, now, NY)).toEqual({
      day: "2026-09-15",
      games: [games[1], games[0]],
    });
  });

  it("caps a busy day and is null with nothing to play", () => {
    const now = new Date("2026-09-14T12:00:00Z");
    const busy = Array.from({ length: LEAGUE_WIDGET_GAMES + 3 }, (_, i) =>
      at(`g${i}`, `2026-09-15T${String(12 + i).padStart(2, "0")}:00:00Z`),
    );
    expect(nextGameDay(busy, now, NY)?.games).toHaveLength(LEAGUE_WIDGET_GAMES);
    expect(nextGameDay([], now, NY)).toBeNull();
  });
});

describe("widgetSeason", () => {
  it("follows the season being played", () => {
    const seasons = [
      { slug: "spring", status: "registration_open" },
      { slug: "fall", status: "in_progress" },
      { slug: "summer", status: "completed" },
    ];
    expect(widgetSeason(seasons)?.slug).toBe("fall");
  });

  it("else the next season still to finish, else the newest", () => {
    expect(
      widgetSeason([
        { slug: "summer", status: "registration_open" },
        { slug: "spring", status: "registration_closed" },
        { slug: "fall", status: "completed" },
      ])?.slug,
    ).toBe("spring");
    expect(
      widgetSeason([
        { slug: "fall", status: "completed" },
        { slug: "summer", status: "completed" },
      ])?.slug,
    ).toBe("fall");
    expect(widgetSeason([])).toBeNull();
  });
});

describe("widgetSnippet", () => {
  it("is one lazy iframe with a title, a height and no script", () => {
    const snippet = widgetSnippet({
      src: "https://league.example.test/embed/schedule/kickers",
      title: "Kickers: next games",
      height: 300,
    });
    expect(snippet).toBe(
      '<iframe src="https://league.example.test/embed/schedule/kickers" title="Kickers: next games" width="100%" height="300" loading="lazy" style="border:0;max-width:420px"></iframe>',
    );
    expect(snippet).not.toContain("<script");
  });

  it("escapes a team name that would break out of the attribute", () => {
    const snippet = widgetSnippet({
      src: "https://league.example.test/embed/schedule/x",
      title: 'The "Big" <Kicks> & Co',
      height: 300,
    });
    expect(snippet).toContain(
      'title="The &quot;Big&quot; &lt;Kicks&gt; &amp; Co"',
    );
  });
});
