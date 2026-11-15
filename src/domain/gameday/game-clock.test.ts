import { describe, expect, it } from "vitest";
import {
  gameClock,
  gameLimits,
  NO_NEW_INNING_MINUTES,
  noNewInningMinutes,
  REGULATION_MINUTES,
} from "./game-clock";

const startsAt = new Date("2026-06-07T18:00:00Z");
const at = (minutes: number) => new Date(startsAt.getTime() + minutes * 60_000);
const regulation = gameLimits(null);

describe("gameLimits", () => {
  it("plays to regulation without a rule set", () => {
    expect(regulation).toEqual({
      innings: 7,
      timeLimitMinutes: REGULATION_MINUTES,
      noNewInningMinutes: NO_NEW_INNING_MINUTES,
    });
    expect(REGULATION_MINUTES).toBe(90);
    expect(NO_NEW_INNING_MINUTES).toBe(10);
  });

  it("follows a rule set, including what it leaves empty", () => {
    expect(
      gameLimits({
        innings: 5,
        timeLimitMinutes: null,
        options: { noNewInningMinutes: 5 },
      }),
    ).toEqual({ innings: 5, timeLimitMinutes: null, noNewInningMinutes: 5 });
  });

  it("uses the default window for a missing or bad setting", () => {
    expect(noNewInningMinutes({})).toBe(10);
    expect(noNewInningMinutes(null)).toBe(10);
    expect(noNewInningMinutes({ noNewInningMinutes: -1 })).toBe(10);
    expect(noNewInningMinutes({ noNewInningMinutes: 2.5 })).toBe(10);
    expect(noNewInningMinutes({ noNewInningMinutes: "5" })).toBe(10);
    expect(noNewInningMinutes({ noNewInningMinutes: 0 })).toBe(0);
  });
});

describe("gameClock", () => {
  it("counts down while there is time to play", () => {
    expect(
      gameClock({
        startsAt,
        now: at(30),
        limits: regulation,
        next: { inning: 3, half: "top" },
      }),
    ).toEqual({
      level: "running",
      minutesLeft: 60,
      message:
        "60 minutes left on the game clock. No new inning starts in the last 10 minutes.",
    });
  });

  it("makes the inning under way the last one inside the window", () => {
    expect(
      gameClock({
        startsAt,
        now: at(81),
        limits: regulation,
        next: { inning: 5, half: "bottom" },
      }),
    ).toMatchObject({
      level: "last_inning",
      minutesLeft: 9,
      message:
        "9 minutes left. No new inning starts in the last 10 minutes, so the 5th is the last inning.",
    });
  });

  it("starts no new inning inside the window", () => {
    expect(
      gameClock({
        startsAt,
        now: at(80),
        limits: regulation,
        next: { inning: 6, half: "top" },
      }),
    ).toMatchObject({
      level: "over",
      message:
        "10 minutes left, inside the last 10 minutes, so the 6th inning doesn't start. The game is over.",
    });
  });

  it("finishes the inning once time is up", () => {
    expect(
      gameClock({
        startsAt,
        now: at(95),
        limits: regulation,
        next: { inning: 6, half: "bottom" },
      }),
    ).toMatchObject({
      level: "last_inning",
      minutesLeft: 0,
      message: "Time is up. Finish the 6th inning; the game ends with it.",
    });
    expect(
      gameClock({
        startsAt,
        now: at(95),
        limits: regulation,
        next: { inning: 7, half: "top" },
      }),
    ).toMatchObject({
      level: "over",
      message: "Time is up, so the 7th inning doesn't start. The game is over.",
    });
  });

  it("follows the rule set's own window", () => {
    expect(
      gameClock({
        startsAt,
        now: at(50),
        limits: { innings: 5, timeLimitMinutes: 55, noNewInningMinutes: 5 },
        next: { inning: 4, half: "top" },
      }),
    ).toMatchObject({ level: "over", minutesLeft: 5 });
  });

  it("says nothing without a time limit, before the start or after the last inning", () => {
    const base = { startsAt, limits: regulation };
    expect(
      gameClock({
        ...base,
        now: at(10),
        limits: { ...regulation, timeLimitMinutes: null },
        next: { inning: 1, half: "bottom" },
      }),
    ).toBeNull();
    expect(
      gameClock({ ...base, now: at(-5), next: { inning: 1, half: "top" } }),
    ).toBeNull();
    expect(
      gameClock({ ...base, now: at(60), next: { inning: 8, half: "top" } }),
    ).toBeNull();
    expect(gameClock({ ...base, now: at(60), next: null })).toBeNull();
    // Entered after the fact, long after the time limit.
    expect(
      gameClock({ ...base, now: at(151), next: { inning: 3, half: "top" } }),
    ).toBeNull();
    expect(
      gameClock({ ...base, now: at(150), next: { inning: 3, half: "top" } }),
    ).toMatchObject({ level: "over" });
  });

  it("lets the first inning start whatever the clock says", () => {
    expect(
      gameClock({
        startsAt,
        now: at(85),
        limits: regulation,
        next: { inning: 1, half: "top" },
      }),
    ).toMatchObject({ level: "last_inning" });
  });
});
