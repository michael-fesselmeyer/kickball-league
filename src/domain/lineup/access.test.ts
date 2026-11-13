import { describe, expect, it } from "vitest";
import { type Subject, VISITOR } from "../authz/permissions";
import { isGameDay, lineupAccess } from "./access";

const TZ = "America/New_York";
// 8 pm in New York on Monday, Sep 14 2026.
const game = {
  id: "g1",
  teamAId: "A",
  teamBId: "B",
  startsAt: new Date("2026-09-15T00:00:00Z"),
  timeZone: TZ,
};
const person = (extra: Partial<Subject>): Subject => ({
  ...VISITOR,
  userId: "u",
  globalRole: "player",
  ...extra,
});
const captainOfA = person({ roster: [{ teamSeasonId: "A", role: "captain" }] });
const playerOfA = person({ roster: [{ teamSeasonId: "A", role: "player" }] });
const ref = person({ isReferee: true, refereeGameIds: ["g1"] });
const admin = person({ globalRole: "admin" });

const MORNING_BEFORE = new Date("2026-09-14T13:00:00Z"); // 9 am that day
const NIGHT_BEFORE = new Date("2026-09-14T03:00:00Z"); // 11 pm the day before

describe("isGameDay", () => {
  it("starts at midnight in the league's time zone", () => {
    expect(isGameDay(game.startsAt, MORNING_BEFORE, TZ)).toBe(true);
    expect(isGameDay(game.startsAt, NIGHT_BEFORE, TZ)).toBe(false);
    expect(isGameDay(game.startsAt, new Date("2026-09-20T00:00:00Z"), TZ)).toBe(
      true,
    );
    expect(isGameDay(null, MORNING_BEFORE, TZ)).toBe(false);
  });
});

describe("lineupAccess", () => {
  it("lets a team's captain and admins edit, any day", () => {
    expect(lineupAccess(captainOfA, game, "A", NIGHT_BEFORE)).toBe("edit");
    expect(lineupAccess(admin, game, "B", NIGHT_BEFORE)).toBe("edit");
  });

  it("shows the other team's order to the captain and the ref on game day", () => {
    expect(lineupAccess(captainOfA, game, "B", NIGHT_BEFORE)).toBe("none");
    expect(lineupAccess(captainOfA, game, "B", MORNING_BEFORE)).toBe("order");
    expect(lineupAccess(ref, game, "A", NIGHT_BEFORE)).toBe("none");
    expect(lineupAccess(ref, game, "A", MORNING_BEFORE)).toBe("order");
  });

  it("never shows players the whole order", () => {
    expect(lineupAccess(playerOfA, game, "A", MORNING_BEFORE)).toBe("none");
    expect(lineupAccess(VISITOR, game, "A", MORNING_BEFORE)).toBe("none");
  });

  it("knows nothing about teams outside the game", () => {
    expect(lineupAccess(admin, game, "C", MORNING_BEFORE)).toBe("none");
  });
});
