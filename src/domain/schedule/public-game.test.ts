import { describe, expect, it } from "vitest";
import { publicGame } from "./fixtures";
import {
  groupByDay,
  hasResult,
  isCalledOff,
  localDay,
  newestTeamSeason,
  nextGame,
  opponentOf,
  outcomeFor,
  placeLine,
  resultLine,
  statusLabel,
} from "./public-game";

const NY = "America/New_York";
const final = (scoreA: number, scoreB: number) =>
  publicGame({ status: "final", scoreA, scoreB });

describe("status and results", () => {
  it("labels each state, and only finished games have a result", () => {
    expect(statusLabel(publicGame())).toBeNull();
    expect(statusLabel(publicGame({ status: "in_progress" }))).toBe("Live");
    expect(statusLabel(final(1, 0))).toBe("Final");
    expect(statusLabel(publicGame({ status: "cancelled" }))).toBe("Cancelled");
    expect(statusLabel(publicGame({ status: "postponed" }))).toBe("Postponed");
    expect(statusLabel(publicGame({ slotCancelled: true }))).toBe("Rained out");
    expect(statusLabel(publicGame({ status: "forfeit", forfeitBy: "a" }))).toBe(
      "Forfeit",
    );
    expect(hasResult(publicGame({ status: "final" }))).toBe(false);
    expect(hasResult(publicGame({ status: "forfeit" }))).toBe(false);
  });

  it("calls off cancelled, postponed and rained-out games", () => {
    expect(isCalledOff(publicGame())).toBe(false);
    expect(isCalledOff(publicGame({ status: "postponed" }))).toBe(true);
    expect(isCalledOff(publicGame({ slotCancelled: true }))).toBe(true);
  });

  it("reads the winner first, and forfeits by the team that showed up", () => {
    expect(resultLine(publicGame())).toBeNull();
    expect(resultLine(final(3, 5))).toBe("Sluggers 5, Kickers 3");
    expect(resultLine(final(4, 4))).toBe("Kickers 4, Sluggers 4");
    expect(resultLine(publicGame({ status: "forfeit", forfeitBy: "a" }))).toBe(
      "Sluggers win by forfeit",
    );
    expect(resultLine(publicGame({ status: "forfeit", forfeitBy: "b" }))).toBe(
      "Kickers win by forfeit",
    );
  });

  it("gives each side its own outcome and opponent", () => {
    expect(outcomeFor(publicGame(), "a")).toBeNull();
    expect(outcomeFor(final(5, 3), "a")).toBe("W");
    expect(outcomeFor(final(5, 3), "b")).toBe("L");
    expect(outcomeFor(final(2, 2), "b")).toBe("T");
    const forfeit = publicGame({ status: "forfeit", forfeitBy: "b" });
    expect(outcomeFor(forfeit, "a")).toBe("W");
    expect(outcomeFor(forfeit, "b")).toBe("L");
    expect(opponentOf(publicGame(), "a").name).toBe("Sluggers");
    expect(opponentOf(publicGame(), "b").name).toBe("Kickers");
  });
});

describe("nextGame", () => {
  const at = (iso: string) => new Date(iso);
  const game = (id: string, start: string, extra = {}) =>
    publicGame({
      id,
      startsAt: at(start),
      endsAt: new Date(at(start).getTime() + 55 * 60_000),
      ...extra,
    });

  it("is the earliest game not over, played or called off", () => {
    const games = [
      game("later", "2026-09-29T00:00:00Z"),
      game("rained", "2026-09-20T00:00:00Z", { slotCancelled: true }),
      game("soon", "2026-09-22T00:00:00Z"),
      game("past", "2026-09-08T00:00:00Z"),
      game("done", "2026-09-21T00:00:00Z", {
        status: "final",
        scoreA: 1,
        scoreB: 0,
      }),
      publicGame({ id: "unplaced", startsAt: null, endsAt: null }),
    ];
    expect(nextGame(games, at("2026-09-15T00:00:00Z"))?.id).toBe("soon");
    // A game in progress is still the next game until it ends.
    expect(nextGame(games, at("2026-09-22T00:30:00Z"))?.id).toBe("soon");
    expect(nextGame(games, at("2026-12-01T00:00:00Z"))).toBeNull();
  });
});

describe("groupByDay", () => {
  it("groups by the league's local date, in kickoff then field order", () => {
    const games = [
      publicGame({
        id: "late",
        startsAt: at("2026-09-15T01:00:00Z"), // 9 pm Monday in New York
        field: "Field 1",
      }),
      publicGame({
        id: "f2",
        startsAt: at("2026-09-15T00:00:00Z"),
        field: "Field 2",
      }),
      publicGame({
        id: "f1",
        startsAt: at("2026-09-15T00:00:00Z"),
        field: "Field 1",
      }),
      publicGame({
        id: "nofield",
        startsAt: at("2026-09-22T00:00:00Z"),
        field: null,
      }),
      publicGame({ id: "unplaced", startsAt: null, endsAt: null }),
    ];
    expect(
      groupByDay(games, NY).map((d) => [d.day, d.games.map((g) => g.id)]),
    ).toEqual([
      ["2026-09-14", ["f1", "f2", "late"]],
      ["2026-09-21", ["nofield"]],
    ]);
  });

  it("dates by the league's zone, not UTC", () => {
    expect(localDay(at("2026-09-15T01:00:00Z"), NY)).toBe("2026-09-14");
  });

  function at(iso: string) {
    return new Date(iso);
  }
});

describe("placeLine", () => {
  it("joins whatever is known", () => {
    expect(placeLine(publicGame())).toBe("Field 2, Riverside Park, 1 Park Ave");
    expect(placeLine(publicGame({ field: null, venue: null }))).toBeNull();
  });
});

describe("newestTeamSeason", () => {
  const at = (iso: string) => new Date(iso);

  it("picks the season of the newest game on one of the player's teams", () => {
    const games = [
      publicGame({
        seasonSlug: "spring-2026",
        startsAt: at("2026-05-01T00:00:00Z"),
      }),
      publicGame({
        seasonSlug: "fall-2026",
        startsAt: at("2026-10-01T00:00:00Z"),
      }),
      publicGame({
        seasonSlug: "summer-2026",
        startsAt: at("2026-07-01T00:00:00Z"),
      }),
    ];
    expect(newestTeamSeason(games, ["a"])).toBe("fall-2026");
    expect(newestTeamSeason(games, ["b"])).toBe("fall-2026");
  });

  it("skips games the player only referees", () => {
    const games = [
      publicGame({ seasonSlug: "fall-2026" }),
      publicGame({
        seasonSlug: "winter-2027",
        startsAt: at("2027-01-01T00:00:00Z"),
        teamA: { id: "x", name: "X", slug: "x", colorHex: null },
        teamB: { id: "y", name: "Y", slug: "y", colorHex: null },
      }),
    ];
    expect(newestTeamSeason(games, ["a"])).toBe("fall-2026");
  });

  it("counts a makeup with no time yet, and is null with no team games", () => {
    expect(
      newestTeamSeason(
        [publicGame({ startsAt: null, seasonSlug: "fall-2026" })],
        ["a"],
      ),
    ).toBe("fall-2026");
    expect(newestTeamSeason([publicGame()], ["z"])).toBeNull();
    expect(newestTeamSeason([], ["a"])).toBeNull();
  });
});
