import { describe, expect, it } from "vitest";
import {
  clearByOnGameDay,
  countdown,
  countdownMessage,
  DEFAULT_DAYLIGHT_MARGIN_MINUTES,
  daylightMargin,
  endOfPlay,
  isLateStart,
  isTight,
  minutesLate,
  punctuality,
  slotPastDaylight,
  type StartRecord,
  sunsetFor,
} from "./daylight";

const NY = "America/New_York";
const CITY_HALL = { lat: 40.7128, lng: -74.006 };

/** The local wall-clock time of an instant in New York, "HH:MM". */
const localHHMM = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: NY,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(d)
    : null;

/** Minutes past local midnight of "HH:MM". */
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * Expect the computed sunset within three minutes of the published one
 * (US Naval Observatory tables for New York City, local clock time).
 */
function expectSunsetNear(gameStartUtc: string, published: string) {
  const got = localHHMM(sunsetFor(new Date(gameStartUtc), NY, CITY_HALL));
  expect(got).not.toBeNull();
  expect(
    Math.abs(toMinutes(got ?? "00:00") - toMinutes(published)),
  ).toBeLessThanOrEqual(3);
}

describe("sunsetFor", () => {
  it("matches the longest day of the year", () => {
    // 21 June 2026, a 6:30 pm EDT game (22:30 UTC).
    expectSunsetNear("2026-06-21T22:30:00Z", "20:31");
  });

  it("matches the shortest day of the year", () => {
    // 21 December 2026, a 4 pm EST game (21:00 UTC).
    expectSunsetNear("2026-12-21T21:00:00Z", "16:32");
  });

  it("matches the earliest sunset of the year, in early December", () => {
    expectSunsetNear("2026-12-07T21:00:00Z", "16:28");
  });

  it("moves an hour later on the clock when daylight saving starts", () => {
    // Clocks go forward on Sunday 8 March 2026.
    expectSunsetNear("2026-03-07T22:00:00Z", "17:53");
    expectSunsetNear("2026-03-08T22:00:00Z", "18:54");
  });

  it("moves an hour earlier on the clock when daylight saving ends", () => {
    // Clocks go back on Sunday 1 November 2026.
    expectSunsetNear("2026-10-31T21:00:00Z", "17:52");
    expectSunsetNear("2026-11-01T21:00:00Z", "16:51");
  });

  it("uses the league's own day for an evening game past midnight in UTC", () => {
    // 7:30 pm EDT on 15 September is 23:30 UTC; 8:30 pm is 00:30 UTC on
    // the 16th. Both are the evening of the 15th.
    const early = sunsetFor(new Date("2026-09-15T23:30:00Z"), NY, CITY_HALL);
    const late = sunsetFor(new Date("2026-09-16T00:30:00Z"), NY, CITY_HALL);
    expect(late).toEqual(early);
    expect(localHHMM(early)).toBe(localHHMM(late));
  });

  it("falls back to City Hall for a park with no coordinates", () => {
    const start = new Date("2026-09-15T22:00:00Z");
    expect(sunsetFor(start, NY, null)).toEqual(sunsetFor(start, NY, CITY_HALL));
  });

  it("is null where the sun does not set", () => {
    expect(
      sunsetFor(new Date("2026-06-21T12:00:00Z"), "UTC", { lat: 80, lng: 0 }),
    ).toBeNull();
  });
});

describe("daylightMargin", () => {
  it("reads the rule set's whole minutes from 0 to 60", () => {
    expect(daylightMargin({ daylightMarginMinutes: 0 })).toBe(0);
    expect(daylightMargin({ daylightMarginMinutes: 30 })).toBe(30);
    expect(daylightMargin({ daylightMarginMinutes: 60 })).toBe(60);
  });

  it("falls back to the default for anything else", () => {
    for (const v of [undefined, -1, 61, 12.5, "20", null])
      expect(daylightMargin({ daylightMarginMinutes: v })).toBe(
        DEFAULT_DAYLIGHT_MARGIN_MINUTES,
      );
    expect(daylightMargin(null)).toBe(DEFAULT_DAYLIGHT_MARGIN_MINUTES);
  });
});

describe("endOfPlay", () => {
  const sunsetAt = new Date("2026-10-06T22:40:00Z");
  const margin = 15;

  it("is sunset less the margin when that comes before the field time", () => {
    expect(
      endOfPlay({
        clearBy: new Date("2026-10-06T23:00:00Z"),
        sunsetAt,
        hasLights: false,
        marginMinutes: margin,
      }),
    ).toEqual({ endsAt: new Date("2026-10-06T22:25:00Z"), reason: "daylight" });
  });

  it("is the field time when that comes first", () => {
    expect(
      endOfPlay({
        clearBy: new Date("2026-10-06T22:00:00Z"),
        sunsetAt,
        hasLights: false,
        marginMinutes: margin,
      }),
    ).toEqual({
      endsAt: new Date("2026-10-06T22:00:00Z"),
      reason: "field_time",
    });
  });

  it("names the field time when both fall at the same minute", () => {
    expect(
      endOfPlay({
        clearBy: new Date("2026-10-06T22:25:00Z"),
        sunsetAt,
        hasLights: false,
        marginMinutes: margin,
      })?.reason,
    ).toBe("field_time");
  });

  it("ignores sunset on a field with lights", () => {
    expect(
      endOfPlay({
        clearBy: new Date("2026-10-06T23:30:00Z"),
        sunsetAt,
        hasLights: true,
        marginMinutes: margin,
      }),
    ).toEqual({
      endsAt: new Date("2026-10-06T23:30:00Z"),
      reason: "field_time",
    });
  });

  it("is daylight alone with no permit, and null with neither", () => {
    expect(
      endOfPlay({
        clearBy: null,
        sunsetAt,
        hasLights: false,
        marginMinutes: 0,
      }),
    ).toEqual({ endsAt: sunsetAt, reason: "daylight" });
    expect(
      endOfPlay({ clearBy: null, sunsetAt, hasLights: true, marginMinutes: 0 }),
    ).toBeNull();
    expect(
      endOfPlay({
        clearBy: null,
        sunsetAt: null,
        hasLights: false,
        marginMinutes: 0,
      }),
    ).toBeNull();
  });
});

describe("clearByOnGameDay", () => {
  // A 7:50 pm game in New York on Monday, Nov 16 (00:50 UTC on the 17th).
  const startsAt = new Date("2026-11-17T00:50:00Z");

  it("keeps a clear-by on the game's own evening", () => {
    const clearBy = new Date("2026-11-17T03:00:00Z"); // 10 pm Monday
    expect(clearByOnGameDay(clearBy, startsAt, NY)).toEqual(clearBy);
  });

  it("keeps a permit that runs past midnight into the small hours", () => {
    const clearBy = new Date("2026-11-17T05:30:00Z"); // 12:30 am Tuesday
    expect(clearByOnGameDay(clearBy, startsAt, NY)).toEqual(clearBy);
  });

  it("drops the next evening's clear-by, a day-long countdown", () => {
    const clearBy = new Date("2026-11-18T03:00:00Z"); // 10 pm Tuesday
    expect(clearByOnGameDay(clearBy, startsAt, NY)).toBeNull();
  });

  it("drops a clear-by from an earlier day", () => {
    const clearBy = new Date("2026-11-11T03:00:00Z"); // 10 pm last Tuesday
    expect(clearByOnGameDay(clearBy, startsAt, NY)).toBeNull();
  });

  it("is null with no clear-by", () => {
    expect(clearByOnGameDay(null, startsAt, NY)).toBeNull();
  });
});

describe("endOfPlay on the game's own day", () => {
  const gameDay = {
    startsAt: new Date("2026-11-17T00:50:00Z"),
    timeZone: NY,
  };
  const tomorrow = new Date("2026-11-18T03:00:00Z");

  it("uses a clear-by on the game's day", () => {
    const clearBy = new Date("2026-11-17T03:00:00Z");
    expect(
      endOfPlay({
        clearBy,
        sunsetAt: null,
        hasLights: true,
        marginMinutes: 15,
        gameDay,
      }),
    ).toEqual({ endsAt: clearBy, reason: "field_time" });
  });

  it("falls back to daylight when the clear-by is on another day", () => {
    const sunsetAt = new Date("2026-11-16T21:35:00Z");
    expect(
      endOfPlay({
        clearBy: tomorrow,
        sunsetAt,
        hasLights: false,
        marginMinutes: 0,
        gameDay,
      }),
    ).toEqual({ endsAt: sunsetAt, reason: "daylight" });
  });

  it("has no end on a lit field whose only clear-by is another day's", () => {
    expect(
      endOfPlay({
        clearBy: tomorrow,
        sunsetAt: null,
        hasLights: true,
        marginMinutes: 15,
        gameDay,
      }),
    ).toBeNull();
  });
});

describe("late starts", () => {
  const due = new Date("2026-10-06T22:00:00Z");
  const after = (min: number) => new Date(due.getTime() + min * 60_000);

  it("counts whole minutes late, and none for an early start", () => {
    expect(minutesLate(due, after(12))).toBe(12);
    expect(minutesLate(due, after(-3))).toBe(0);
  });

  it("allows a five-minute grace", () => {
    expect(isLateStart(due, after(5))).toBe(false);
    expect(isLateStart(due, after(6))).toBe(true);
  });
});

describe("countdown", () => {
  const firstPitchAt = new Date("2026-10-06T22:00:00Z");
  const endsAt = new Date("2026-10-06T23:10:00Z");
  const at = (min: number) => new Date(firstPitchAt.getTime() + min * 60_000);
  const end = { endsAt, reason: "daylight" as const };

  it("counts down to first pitch with the play it leaves", () => {
    const c = countdown({
      firstPitchAt,
      startedAt: null,
      endsAt,
      now: at(-10),
    });
    expect(c).toEqual({
      phase: "before",
      minutesToFirstPitch: 10,
      minutesOfPlay: 70,
    });
    expect(countdownMessage(c, end)).toBe(
      "First pitch in 10 minutes. That leaves 70 minutes of play before dark.",
    );
  });

  it("takes every minute late off the game", () => {
    const c = countdown({ firstPitchAt, startedAt: null, endsAt, now: at(12) });
    expect(c).toEqual({ phase: "late", minutesLate: 12, minutesOfPlay: 58 });
    expect(countdownMessage(c, { endsAt, reason: "field_time" })).toContain(
      "58 minutes of play left before the field must be clear",
    );
  });

  it("counts down to the end once started, whatever the clock said", () => {
    expect(
      countdown({ firstPitchAt, startedAt: at(3), endsAt, now: at(50) }),
    ).toEqual({ phase: "playing", minutesLeft: 20 });
    expect(
      countdown({
        firstPitchAt,
        startedAt: at(3),
        endsAt,
        now: new Date(at(50).getTime() + 30_000),
      }),
    ).toEqual({ phase: "playing", minutesLeft: 20 });
  });

  it("is over at the end, started or not", () => {
    expect(
      countdown({ firstPitchAt, startedAt: at(0), endsAt, now: at(70) }),
    ).toEqual({ phase: "over", minutesOver: 0 });
    const c = countdown({ firstPitchAt, startedAt: null, endsAt, now: at(75) });
    expect(c).toEqual({ phase: "over", minutesOver: 5 });
    expect(countdownMessage(c, end)).toMatch(/before dark/);
  });

  it("says one minute, not one minutes", () => {
    const c = countdown({
      firstPitchAt,
      startedAt: at(0),
      endsAt,
      now: at(69),
    });
    expect(countdownMessage(c, end)).toBe("1 minute of play left before dark.");
  });

  it("leaves no play when the end comes before first pitch", () => {
    expect(
      countdown({
        firstPitchAt,
        startedAt: null,
        endsAt: at(-5),
        now: at(-20),
      }),
    ).toEqual({ phase: "before", minutesToFirstPitch: 20, minutesOfPlay: 0 });
  });
});

describe("slotPastDaylight", () => {
  // A 7:15 to 8:15 pm EDT slot on 6 October: sunset is about 6:35 pm.
  const slot = {
    slotStartsAt: new Date("2026-10-06T23:15:00Z"),
    slotEndsAt: new Date("2026-10-07T00:15:00Z"),
    timeZone: NY,
    at: CITY_HALL,
    marginMinutes: 15,
  };

  it("warns about a fall slot that runs into the dark", () => {
    const warning = slotPastDaylight({ ...slot, hasLights: false });
    expect(warning?.minutesShort).toBeGreaterThan(90);
  });

  it("says nothing for a field with lights", () => {
    expect(slotPastDaylight({ ...slot, hasLights: true })).toBeNull();
  });

  it("says nothing for a 7 to 8 pm slot in June", () => {
    expect(
      slotPastDaylight({
        ...slot,
        slotStartsAt: new Date("2026-06-16T23:00:00Z"),
        slotEndsAt: new Date("2026-06-17T00:00:00Z"),
        hasLights: false,
      }),
    ).toBeNull();
  });
});

describe("punctuality", () => {
  const due = new Date("2026-10-06T22:00:00Z");
  const after = (min: number) => new Date(due.getTime() + min * 60_000);
  const rec = (
    teamAId: string,
    teamBId: string,
    late: number,
    heldUpBy: StartRecord["heldUpBy"],
  ): StartRecord => ({
    teamAId,
    teamBId,
    firstPitchAt: due,
    startedAt: after(late),
    heldUpBy,
  });

  it("counts late starts against the team named for them", () => {
    const rows = punctuality([
      rec("aces", "bees", 15, "team_a"),
      rec("bees", "aces", 10, "team_b"),
      rec("aces", "cats", 2, "team_a"),
      rec("bees", "cats", 20, "both"),
      rec("cats", "bees", 9, "neither"),
      rec("cats", "aces", 30, null),
    ]);
    expect(rows).toEqual([
      { teamSeasonId: "aces", starts: 4, lateStarts: 2, minutesLost: 25 },
      { teamSeasonId: "bees", starts: 4, lateStarts: 1, minutesLost: 20 },
      { teamSeasonId: "cats", starts: 4, lateStarts: 1, minutesLost: 20 },
    ]);
  });

  it("is empty with no starts", () => {
    expect(punctuality([])).toEqual([]);
  });
});

describe("isTight", () => {
  const slotEnd = new Date("2026-10-06T23:00:00Z");
  const plus = (min: number) => new Date(slotEnd.getTime() + min * 60_000);

  it("is tight when play ends within a quarter hour of the slot's end", () => {
    expect(isTight(slotEnd, plus(-20))).toBe(true);
    expect(isTight(slotEnd, plus(0))).toBe(true);
    expect(isTight(slotEnd, plus(15))).toBe(true);
  });

  it("has time to spare after that", () => {
    expect(isTight(slotEnd, plus(16))).toBe(false);
  });
});
