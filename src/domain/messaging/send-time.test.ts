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

  it("is the sweep on the chosen day", () => {
    expect(sweepOn("2026-11-17")).toEqual(new Date("2026-11-17T13:30:00Z"));
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
    expect(parseSendAt({}, NOW)).toEqual({ ok: true, value: null });
    expect(parseSendAt({ when: "now", day: "2026-11-20" }, NOW)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("schedules for the next sweep or a chosen day", () => {
    expect(parseSendAt({ when: "next" }, NOW)).toEqual({
      ok: true,
      value: new Date("2026-11-15T13:30:00Z"),
    });
    expect(parseSendAt({ when: "day", day: "2026-11-20" }, NOW)).toEqual({
      ok: true,
      value: new Date("2026-11-20T13:30:00Z"),
    });
  });

  it("refuses a day whose send has passed, one too far ahead, or junk", () => {
    expect(parseSendAt({ when: "day", day: "2026-11-14" }, NOW)).toEqual({
      ok: false,
      error: "send_day_passed",
    });
    const far = new Date(NOW.getTime() + (MAX_DAYS_AHEAD + 2) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(parseSendAt({ when: "day", day: far }, NOW)).toEqual({
      ok: false,
      error: "send_day_far",
    });
    for (const day of ["", "2026-02-30", "tomorrow", undefined])
      expect(parseSendAt({ when: "day", day }, NOW)).toEqual({
        ok: false,
        error: "bad_send_time",
      });
    expect(parseSendAt({ when: "later" }, NOW).ok).toBe(false);
  });
});
