import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { localDate } from "@/domain/scheduler/slots";
import { localTime } from "@/domain/time/zoned";
import type { DeliveryClass } from "./kinds";
import {
  type AlertLimits,
  alertLimitsForm,
  DEFAULT_LIMITS,
  DIGEST_HOUR,
  decide,
  hourLabel,
  inQuietHours,
  nextDigestAt,
  type QuietHours,
  quietHoursEnd,
  startOfLocalDay,
  startOfLocalHour,
} from "./limits";

const NY = "America/New_York";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Zones with every kind of clock change: US and European DST, a 30-minute
 * change (Lord Howe), a 2-hour one (Troll), changes at midnight (Havana,
 * Santiago), odd offsets with no change (Kolkata, Chatham in winter), and
 * the southern hemisphere.
 */
const ZONES = [
  NY,
  "America/Los_Angeles",
  "Europe/Berlin",
  "Europe/London",
  "Australia/Lord_Howe",
  "Antarctica/Troll",
  "America/Havana",
  "America/Santiago",
  "Asia/Kolkata",
  "Pacific/Chatham",
  "UTC",
] as const;

const zone = fc.constantFrom(...ZONES);

/** Instants across 2026-2028, minute-aligned, so every DST change is in range. */
const instant = fc
  .integer({
    min: Date.parse("2026-01-01T00:00:00Z") / MINUTE,
    max: Date.parse("2028-12-31T00:00:00Z") / MINUTE,
  })
  .map((m) => new Date(m * MINUTE));

/** Instants within a day of a DST change in the US, Europe or Lord Howe. */
const nearChange = fc
  .tuple(
    fc.constantFrom(
      "2026-03-08T07:00:00Z",
      "2026-11-01T06:00:00Z",
      "2026-03-29T01:00:00Z",
      "2026-10-25T01:00:00Z",
      "2026-04-04T15:00:00Z",
      "2026-10-03T15:30:00Z",
      "2026-03-29T01:00:00Z",
    ),
    fc.integer({ min: -36 * 60, max: 36 * 60 }),
  )
  .map(([at, m]) => new Date(Date.parse(at) + m * MINUTE));

const when = fc.oneof(instant, nearChange);

const quietHours: fc.Arbitrary<QuietHours> = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 23 }))
  .filter(([s, e]) => s !== e)
  .map(([startHour, endHour]) => ({ startHour, endHour }));

const limits: fc.Arbitrary<AlertLimits> = fc.record({
  dailyCap: fc.integer({ min: 0, max: 3 }),
  digest: fc.constantFrom("daily", "weekly"),
  quietHours: fc.option(quietHours, { nil: null }),
});

const deliveryClass = fc.constantFrom<DeliveryClass>(
  "urgent",
  "non_urgent",
  "digest",
);

describe("startOfLocalHour", () => {
  it("is the instant the clock reads that hour", () => {
    expect(startOfLocalHour("2026-07-01", 18, NY).toISOString()).toBe(
      "2026-07-01T22:00:00.000Z",
    );
  });

  it("takes the first reading of an hour a fall-back change repeats", () => {
    // 1 am happens twice in New York on Nov 1, 2026; 2 am twice in Berlin
    // on Oct 25. Both zones get the earlier one.
    expect(startOfLocalHour("2026-11-01", 1, NY).toISOString()).toBe(
      "2026-11-01T05:00:00.000Z",
    );
    expect(
      startOfLocalHour("2026-10-25", 2, "Europe/Berlin").toISOString(),
    ).toBe("2026-10-25T00:00:00.000Z");
  });

  it("takes the jump past an hour a spring-forward change skips", () => {
    // 2 am never happens in New York on Mar 8, 2026: 1:59 is followed by 3:00.
    expect(startOfLocalHour("2026-03-08", 2, NY).toISOString()).toBe(
      "2026-03-08T07:00:00.000Z",
    );
  });

  it("is the earliest instant reading that date at or after that hour", () => {
    fc.assert(
      fc.property(when, zone, fc.integer({ min: 0, max: 23 }), (at, tz, hh) => {
        const date = localDate(at, tz);
        const start = startOfLocalHour(date, hh, tz);
        const reads = (t: Date) =>
          localDate(t, tz) === date &&
          localTime(t, tz) >= `${String(hh).padStart(2, "0")}:00`;
        expect(reads(start)).toBe(true);
        expect(reads(new Date(start.getTime() - MINUTE))).toBe(false);
      }),
    );
  });
});

describe("startOfLocalDay", () => {
  it("is local midnight", () => {
    expect(
      startOfLocalDay(new Date("2026-07-01T03:00:00Z"), NY).toISOString(),
    ).toBe("2026-06-30T04:00:00.000Z");
  });
});

describe("inQuietHours", () => {
  const night = { startHour: 22, endHour: 8 };

  it("covers 10 pm to 8 am by default", () => {
    const at = (iso: string) => inQuietHours(new Date(iso), NY, night);
    expect(at("2026-07-02T01:59:00Z")).toBe(false); // 9:59 pm
    expect(at("2026-07-02T02:00:00Z")).toBe(true); // 10 pm
    expect(at("2026-07-02T11:59:00Z")).toBe(true); // 7:59 am
    expect(at("2026-07-02T12:00:00Z")).toBe(false); // 8 am
  });

  it("handles quiet hours inside one day", () => {
    const afternoon = { startHour: 13, endHour: 15 };
    expect(inQuietHours(new Date("2026-07-02T18:00:00Z"), NY, afternoon)).toBe(
      true,
    );
    expect(inQuietHours(new Date("2026-07-02T19:00:00Z"), NY, afternoon)).toBe(
      false,
    );
  });

  it("is never quiet when quiet hours are off or empty", () => {
    const at = new Date("2026-07-02T04:00:00Z");
    expect(inQuietHours(at, NY, null)).toBe(false);
    expect(inQuietHours(at, NY, { startHour: 3, endHour: 3 })).toBe(false);
  });
});

describe("quietHoursEnd", () => {
  it("is 8 am the next morning for a message at 11 pm", () => {
    expect(
      quietHoursEnd(
        new Date("2026-07-02T03:00:00Z"),
        NY,
        DEFAULT_LIMITS.quietHours,
      ).toISOString(),
    ).toBe("2026-07-02T12:00:00.000Z");
  });

  it("follows the clock on the morning DST starts and ends", () => {
    const night = { startHour: 22, endHour: 8 };
    // Sat Mar 7, 11 pm EST -> Sun 8 am EDT: only 8 hours later.
    expect(
      quietHoursEnd(new Date("2026-03-08T04:00:00Z"), NY, night).toISOString(),
    ).toBe("2026-03-08T12:00:00.000Z");
    // Sat Oct 31, 11 pm EDT -> Sun 8 am EST: 10 hours later.
    expect(
      quietHoursEnd(new Date("2026-11-01T03:00:00Z"), NY, night).toISOString(),
    ).toBe("2026-11-01T13:00:00.000Z");
  });

  it("ends when a clock change turns the clock back to before they start", () => {
    // Troll falls back two hours at 01:00 UTC on Oct 25, 2026: 02:59 (+02)
    // is followed by 01:00 (+00), outside quiet hours from 2 am to midnight.
    const twoToMidnight = { startHour: 2, endHour: 0 };
    expect(
      quietHoursEnd(
        new Date("2026-10-25T00:59:00Z"),
        "Antarctica/Troll",
        twoToMidnight,
      ).toISOString(),
    ).toBe("2026-10-25T01:00:00.000Z");
  });

  it("is now when it is not quiet", () => {
    const now = new Date("2026-07-02T16:00:00Z");
    expect(quietHoursEnd(now, NY, DEFAULT_LIMITS.quietHours)).toBe(now);
    expect(quietHoursEnd(now, NY, null)).toBe(now);
  });

  it("is the first moment after now that is not quiet, in every zone", () => {
    fc.assert(
      fc.property(when, zone, quietHours, (now, tz, quiet) => {
        const end = quietHoursEnd(now, tz, quiet);
        if (!inQuietHours(now, tz, quiet)) {
          expect(end).toBe(now);
          return;
        }
        expect(end.getTime()).toBeGreaterThan(now.getTime());
        expect(end.getTime() - now.getTime()).toBeLessThanOrEqual(24 * HOUR);
        expect(inQuietHours(end, tz, quiet)).toBe(false);
        // Everything before it is still quiet, checked every 10 minutes and
        // at the minute before.
        for (let t = now.getTime(); t < end.getTime(); t += 10 * MINUTE)
          expect(inQuietHours(new Date(t), tz, quiet)).toBe(true);
        expect(inQuietHours(new Date(end.getTime() - MINUTE), tz, quiet)).toBe(
          true,
        );
      }),
      { numRuns: 300 },
    );
  });
});

describe("nextDigestAt", () => {
  it("is 6 pm today, or tomorrow once 6 pm has passed", () => {
    expect(
      nextDigestAt(new Date("2026-07-01T15:00:00Z"), NY, "daily").toISOString(),
    ).toBe("2026-07-01T22:00:00.000Z");
    expect(
      nextDigestAt(new Date("2026-07-01T22:00:00Z"), NY, "daily").toISOString(),
    ).toBe("2026-07-02T22:00:00.000Z");
  });

  it("is the next Sunday at 6 pm when weekly", () => {
    // Wed Jul 1, 2026 -> Sun Jul 5.
    expect(
      nextDigestAt(
        new Date("2026-07-01T15:00:00Z"),
        NY,
        "weekly",
      ).toISOString(),
    ).toBe("2026-07-05T22:00:00.000Z");
  });

  it("is always later, at 6 pm local, within a day or a week", () => {
    fc.assert(
      fc.property(
        when,
        zone,
        fc.constantFrom("daily", "weekly"),
        (now, tz, frequency) => {
          const at = nextDigestAt(now, tz, frequency);
          expect(at.getTime()).toBeGreaterThan(now.getTime());
          expect(localTime(at, tz)).toBe(`${DIGEST_HOUR}:00`);
          const most = (frequency === "daily" ? 1 : 7) * 24 * HOUR + 2 * HOUR;
          expect(at.getTime() - now.getTime()).toBeLessThanOrEqual(most);
          if (frequency === "weekly")
            expect(new Date(`${localDate(at, tz)}T12:00:00Z`).getUTCDay()).toBe(
              0,
            );
        },
      ),
    );
  });
});

describe("decide", () => {
  const base = {
    channel: "email" as const,
    timeZone: NY,
    limits: DEFAULT_LIMITS,
    sentToday: 0,
  };
  const noon = new Date("2026-07-01T16:00:00Z");
  const midnight = new Date("2026-07-01T04:00:00Z");

  it("sends urgent messages at once, silently on a phone in quiet hours", () => {
    expect(decide({ ...base, class: "urgent", now: midnight })).toEqual({
      action: "send",
      silent: false,
    });
    expect(
      decide({ ...base, class: "urgent", channel: "push", now: midnight }),
    ).toEqual({ action: "send", silent: true });
    expect(
      decide({ ...base, class: "urgent", channel: "push", now: noon }),
    ).toEqual({ action: "send", silent: false });
  });

  it("holds non-urgent messages until quiet hours end", () => {
    expect(decide({ ...base, class: "non_urgent", now: midnight })).toEqual({
      action: "wait",
      until: new Date("2026-07-01T12:00:00Z"),
    });
  });

  it("folds non-urgent messages over the cap into the next digest", () => {
    expect(
      decide({ ...base, class: "non_urgent", now: noon, sentToday: 2 }),
    ).toEqual({ action: "send", silent: false });
    expect(
      decide({ ...base, class: "non_urgent", now: noon, sentToday: 3 }),
    ).toEqual({ action: "hold", until: new Date("2026-07-01T22:00:00Z") });
  });

  it("never caps the digest, but keeps it out of quiet hours", () => {
    expect(
      decide({ ...base, class: "digest", now: noon, sentToday: 99 }),
    ).toEqual({ action: "send", silent: false });
    expect(decide({ ...base, class: "digest", now: midnight }).action).toBe(
      "wait",
    );
  });

  it("never delays or drops an urgent message", () => {
    fc.assert(
      fc.property(
        when,
        zone,
        limits,
        fc.constantFrom("email" as const, "push" as const),
        fc.nat(10),
        (now, timeZone, l, channel, sentToday) => {
          const d = decide({
            class: "urgent",
            channel,
            now,
            timeZone,
            limits: l,
            sentToday,
          });
          expect(d.action).toBe("send");
          if (d.action === "send" && channel === "email")
            expect(d.silent).toBe(false);
        },
      ),
    );
  });

  it("always gives a later time when it does not send now", () => {
    fc.assert(
      fc.property(
        when,
        zone,
        limits,
        deliveryClass,
        fc.nat(10),
        (now, timeZone, l, cls, sentToday) => {
          const d = decide({
            class: cls,
            channel: "email",
            now,
            timeZone,
            limits: l,
            sentToday,
          });
          if (d.action !== "send")
            expect(d.until.getTime()).toBeGreaterThan(now.getTime());
        },
      ),
    );
  });

  /**
   * A week of one person's non-urgent messages through a model of the
   * outbox: each is decided when it arrives, again when its wait ends, and
   * held ones go out in the digest at its time. Every message must arrive,
   * none individually in quiet hours, and no more than the cap a local day.
   */
  it("delivers every non-urgent message, within the cap and outside quiet hours", () => {
    fc.assert(
      fc.property(
        fc.oneof(instant, nearChange),
        zone,
        limits,
        fc.array(fc.integer({ min: 0, max: 7 * 24 * 60 }), {
          minLength: 1,
          maxLength: 25,
        }),
        (start, timeZone, l, offsets) => {
          type Item = { id: number; at: number };
          const queue: Item[] = offsets.map((m, id) => ({
            id,
            at: start.getTime() + m * MINUTE,
          }));
          const sentAt = new Map<number, number>();
          const held = new Map<number, number>();
          const perDay = new Map<string, number>();
          for (let steps = 0; queue.length > 0; steps++) {
            expect(steps).toBeLessThan(500);
            queue.sort((a, b) => a.at - b.at);
            const item = queue.shift();
            if (!item) break;
            const now = new Date(item.at);
            const day = localDate(now, timeZone);
            const d = decide({
              class: "non_urgent",
              channel: "email",
              now,
              timeZone,
              limits: l,
              sentToday: perDay.get(day) ?? 0,
            });
            if (d.action === "send") {
              expect(inQuietHours(now, timeZone, l.quietHours)).toBe(false);
              perDay.set(day, (perDay.get(day) ?? 0) + 1);
              sentAt.set(item.id, item.at);
            } else if (d.action === "wait") {
              queue.push({ id: item.id, at: d.until.getTime() });
            } else {
              held.set(item.id, d.until.getTime());
            }
          }
          for (const count of perDay.values())
            expect(count).toBeLessThanOrEqual(l.dailyCap);
          // Each message is sent on its own or in a digest, never both,
          // never neither.
          for (const id of offsets.keys())
            expect(sentAt.has(id) !== held.has(id)).toBe(true);
          // The digest a held message waits for is never in the past.
          for (const [id, digestAt] of held)
            expect(digestAt).toBeGreaterThan(
              start.getTime() + (offsets[id] ?? 0) * MINUTE,
            );
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("alertLimitsForm", () => {
  const form = {
    dailyCap: "2",
    digest: "weekly",
    quiet: "on",
    quietStart: "23",
    quietEnd: "7",
  };

  it("reads the settings form", () => {
    expect(alertLimitsForm.parse(form)).toEqual({
      dailyCap: 2,
      digest: "weekly",
      quietHours: { startHour: 23, endHour: 7 },
    });
  });

  it("turns quiet hours off when the box is unchecked", () => {
    const off = { ...form, quiet: undefined };
    expect(alertLimitsForm.parse(off).quietHours).toBeNull();
    expect(alertLimitsForm.parse({ ...form, quiet: "" }).quietHours).toBeNull();
  });

  it("lets quiet hours that are off keep any start and end", () => {
    expect(
      alertLimitsForm.parse({
        ...form,
        quiet: "",
        quietStart: "7",
        quietEnd: "7",
      }).quietHours,
    ).toBeNull();
  });

  it("refuses a cap above the default, or empty quiet hours", () => {
    expect(alertLimitsForm.safeParse({ ...form, dailyCap: "4" }).success).toBe(
      false,
    );
    expect(
      alertLimitsForm.safeParse({ ...form, quietStart: "7", quietEnd: "7" })
        .success,
    ).toBe(false);
  });
});

describe("hourLabel", () => {
  it("reads like a clock", () => {
    expect([0, 8, 12, 22].map(hourLabel)).toEqual([
      "midnight",
      "8 am",
      "noon",
      "10 pm",
    ]);
  });
});
