import { describe, expect, it } from "vitest";
import { type Subject, VISITOR } from "../authz/permissions";
import { publicGame } from "../schedule/fixtures";
import {
  NEXT_GAME_GRACE_MS,
  offeredInstall,
  offlineGame,
  pickNextGame,
} from "./offline";

const player: Subject = { ...VISITOR, userId: "u1", globalRole: "player" };

describe("offeredInstall", () => {
  it("is not offered to visitors or plain players", () => {
    expect(offeredInstall(VISITOR)).toBe(false);
    expect(offeredInstall(player)).toBe(false);
    expect(
      offeredInstall({
        ...player,
        roster: [{ teamSeasonId: "t1", role: "player" }],
      }),
    ).toBe(false);
  });

  it("is offered to captains, co-captains, referees and admins", () => {
    for (const role of ["captain", "co_captain"] as const)
      expect(
        offeredInstall({ ...player, roster: [{ teamSeasonId: "t1", role }] }),
      ).toBe(true);
    expect(offeredInstall({ ...player, isReferee: true })).toBe(true);
    expect(offeredInstall({ ...player, globalRole: "admin" })).toBe(true);
    expect(offeredInstall({ ...player, globalRole: "owner" })).toBe(true);
  });
});

describe("pickNextGame", () => {
  const now = new Date("2026-09-20T22:00:00Z");
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
  const hour = 60 * 60 * 1000;

  it("picks the soonest upcoming game, in any input order", () => {
    const later = publicGame({ id: "later", startsAt: at(48 * hour) });
    const sooner = publicGame({ id: "sooner", startsAt: at(2 * hour) });
    expect(pickNextGame([later, sooner], now)?.id).toBe("sooner");
    expect(pickNextGame([sooner, later], now)?.id).toBe("sooner");
  });

  it("keeps a game that kicked off within the grace period", () => {
    const playing = publicGame({
      id: "playing",
      status: "in_progress",
      startsAt: at(-hour),
    });
    const tomorrow = publicGame({ id: "tomorrow", startsAt: at(24 * hour) });
    expect(pickNextGame([tomorrow, playing], now)?.id).toBe("playing");
    const old = publicGame({ startsAt: at(-NEXT_GAME_GRACE_MS - 1) });
    expect(pickNextGame([old], now)).toBeNull();
  });

  it("skips finished, called-off and unplaced games", () => {
    const games = [
      publicGame({ status: "final", startsAt: at(hour) }),
      publicGame({ status: "forfeit", startsAt: at(hour) }),
      publicGame({ status: "cancelled", startsAt: at(hour) }),
      publicGame({ status: "postponed", startsAt: at(hour) }),
      publicGame({ slotCancelled: true, startsAt: at(hour) }),
      publicGame({ startsAt: null }),
    ];
    expect(pickNextGame(games, now)).toBeNull();
    expect(pickNextGame([], now)).toBeNull();
  });
});

describe("offlineGame", () => {
  it("links the public game page and labels it in the league's zone", () => {
    const game = publicGame({ startsAt: new Date("2026-09-15T00:00:00Z") });
    expect(offlineGame(game, "America/New_York")).toEqual({
      path: `/games/${game.id}`,
      label: "Kickers vs Sluggers, Mon, Sep 14 at 8:00 PM",
      permit: null,
    });
    expect(offlineGame(game, "America/New_York", true).permit).toBe(
      `/app/games/${game.id}/permit`,
    );
  });

  it("leaves the time out when the game has none", () => {
    expect(offlineGame(publicGame({ startsAt: null }), "UTC").label).toBe(
      "Kickers vs Sluggers",
    );
  });
});
