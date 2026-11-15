import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MAX_DAYS_AHEAD,
  nextSweep,
  OUTBOX_SWEEP_UTC,
  parseSendAt,
  sweepOn,
} from "./send-time";

const NOW = new Date("2026-11-14T15:00:00Z");
const NY = "America/New_York";

describe("the send time", () => {
  it("matches the outbox sweep vercel.json schedules", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    const outbox = config.crons.find((c) => c.path === "/api/jobs/outbox");
    expect(outbox?.schedule).toBe(
      `${OUTBOX_SWEEP_UTC.minute} ${OUTBOX_SWEEP_UTC.hour} * * *`,
    );
  });

  it("is the sweep on the chosen day in the league's time zone", () => {
    // New York: 8:30 a.m. in winter, 9:30 a.m. in summer, the same date.
    expect(sweepOn("2026-11-17", NY)).toEqual(new Date("2026-11-17T13:30:00Z"));
    expect(sweepOn("2027-07-04", NY)).toEqual(new Date("2027-07-04T13:30:00Z"));
    // Either side of the clocks changing, still that day.
    expect(sweepOn("2027-03-14", NY)).toEqual(new Date("2027-03-14T13:30:00Z"));
    expect(sweepOn("2026-11-01", NY)).toEqual(new Date("2026-11-01T13:30:00Z"));
    // Far east of UTC the sweep the day before lands on the chosen day.
    expect(sweepOn("2026-11-20", "Pacific/Auckland")).toEqual(
      new Date("2026-11-19T13:30:00Z"),
    );
    expect(sweepOn("2026-11-20", "UTC")).toEqual(
      new Date("2026-11-20T13:30:00Z"),
    );
  });

  it("always lands on the chosen local day", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 800 }),
        fc.constantFrom(
          "America/New_York",
          "America/Los_Angeles",
          "Pacific/Honolulu",
          "Europe/London",
          "Asia/Kolkata",
          "Australia/Sydney",
          "Pacific/Auckland",
          "Pacific/Kiritimati",
        ),
        (offset, zone) => {
          const day = new Date(Date.UTC(2026, 0, 1) + offset * 86_400_000)
            .toISOString()
            .slice(0, 10);
          const at = sweepOn(day, zone);
          const local = new Intl.DateTimeFormat("en-CA", {
            timeZone: zone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(at);
          expect(local).toBe(day);
        },
      ),
    );
  });

  it("goes with today's sweep before it runs, else tomorrow's", () => {
    expect(nextSweep(new Date("2026-11-14T09:00:00Z"))).toEqual(
      new Date("2026-11-14T13:30:00Z"),
    );
    expect(nextSweep(NOW)).toEqual(new Date("2026-11-15T13:30:00Z"));
  });

  it("is always a sweep within a day after now", () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date("2026-01-01T00:00:00Z"),
          max: new Date("2030-01-01T00:00:00Z"),
          noInvalidDate: true,
        }),
        (now) => {
          const at = nextSweep(now);
          expect(at > now).toBe(true);
          expect(at.getTime() - now.getTime()).toBeLessThanOrEqual(86_400_000);
          expect(at.getUTCHours()).toBe(OUTBOX_SWEEP_UTC.hour);
          expect(at.getUTCMinutes()).toBe(OUTBOX_SWEEP_UTC.minute);
        },
      ),
    );
  });
});

describe("parseSendAt", () => {
  it("sends now unless told otherwise", () => {
    expect(parseSendAt({}, NOW, NY)).toEqual({ ok: true, value: null });
    expect(parseSendAt({ when: "now", day: "2026-11-20" }, NOW, NY)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("schedules for the next sweep or a chosen day", () => {
    expect(parseSendAt({ when: "next" }, NOW, NY)).toEqual({
      ok: true,
      value: new Date("2026-11-15T13:30:00Z"),
    });
    expect(parseSendAt({ when: "day", day: "2026-11-20" }, NOW, NY)).toEqual({
      ok: true,
      value: new Date("2026-11-20T13:30:00Z"),
    });
  });

  it("reads the day in the league's time zone", () => {
    expect(
      parseSendAt({ when: "day", day: "2026-11-20" }, NOW, "Pacific/Auckland"),
    ).toEqual({ ok: true, value: new Date("2026-11-19T13:30:00Z") });
    // In Auckland it is already Nov 15 and that day's sweep has run.
    expect(
      parseSendAt({ when: "day", day: "2026-11-15" }, NOW, "Pacific/Auckland"),
    ).toEqual({ ok: false, error: "send_day_passed" });
  });

  it("refuses a day whose send has passed, one too far ahead, or junk", () => {
    expect(parseSendAt({ when: "day", day: "2026-11-14" }, NOW, NY)).toEqual({
      ok: false,
      error: "send_day_passed",
    });
    const far = new Date(NOW.getTime() + (MAX_DAYS_AHEAD + 2) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(parseSendAt({ when: "day", day: far }, NOW, NY)).toEqual({
      ok: false,
      error: "send_day_far",
    });
    for (const day of ["", "2026-02-30", "tomorrow", undefined])
      expect(parseSendAt({ when: "day", day }, NOW, NY)).toEqual({
        ok: false,
        error: "bad_send_time",
      });
    expect(parseSendAt({ when: "later" }, NOW, NY).ok).toBe(false);
  });
});
