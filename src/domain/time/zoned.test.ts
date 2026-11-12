import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { localDate } from "../scheduler/slots";
import { localTime, weeklyDates, zonedInstant } from "./zoned";

const NY = "America/New_York";

describe("zonedInstant", () => {
  it("reads New York wall-clock times on both sides of daylight saving", () => {
    expect(zonedInstant("2027-01-11", "20:00", NY).toISOString()).toBe(
      "2027-01-12T01:00:00.000Z",
    );
    expect(zonedInstant("2027-04-12", "20:00", NY).toISOString()).toBe(
      "2027-04-13T00:00:00.000Z",
    );
  });

  it("reads a time just after fall-back in standard time", () => {
    expect(zonedInstant("2027-11-07", "03:00", NY).toISOString()).toBe(
      "2027-11-07T08:00:00.000Z",
    );
  });

  it("handles zones east of UTC and half-hour offsets", () => {
    expect(
      zonedInstant("2027-06-01", "09:00", "Asia/Kolkata").toISOString(),
    ).toBe("2027-06-01T03:30:00.000Z");
  });

  it("moves a time skipped by spring-forward an hour later", () => {
    // 2:30 am does not exist in New York on 2027-03-14.
    expect(zonedInstant("2027-03-14", "02:30", NY).toISOString()).toBe(
      "2027-03-14T07:30:00.000Z",
    );
  });

  it("rejects malformed input", () => {
    expect(() => zonedInstant("2027-1-1", "20:00", NY)).toThrow("Bad date");
    expect(() => zonedInstant("2027-01-01", "24:00", NY)).toThrow("Bad time");
  });

  it("round-trips with localDate and localTime", () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date("2026-01-01T00:00:00Z"),
          max: new Date("2030-12-31T00:00:00Z"),
          noInvalidDate: true,
        }),
        fc.integer({ min: 0, max: 1439 }),
        fc.constantFrom(NY, "Europe/London", "Asia/Kolkata", "UTC"),
        (day, minute, zone) => {
          const date = day.toISOString().slice(0, 10);
          const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
          const instant = zonedInstant(date, time, zone);
          // Skipped times read an hour later; every other time reads back.
          expect(localDate(instant, zone)).toBe(date);
          const read = localTime(instant, zone).split(":").map(Number);
          const shift = (read[0] ?? 0) * 60 + (read[1] ?? 0) - minute;
          expect([0, 60]).toContain(shift);
        },
      ),
    );
  });
});

describe("localTime", () => {
  it("formats an instant as local HH:MM", () => {
    expect(localTime(new Date("2027-04-13T00:00:00Z"), NY)).toBe("20:00");
    expect(localTime(new Date("2027-01-12T01:30:00Z"), NY)).toBe("20:30");
  });
});

describe("weeklyDates", () => {
  it("steps a week at a time across month ends and daylight saving", () => {
    expect(weeklyDates("2027-03-08", 3)).toEqual([
      "2027-03-08",
      "2027-03-15",
      "2027-03-22",
    ]);
    expect(weeklyDates("2027-12-27", 2)).toEqual(["2027-12-27", "2028-01-03"]);
    expect(weeklyDates("2027-03-08", 0)).toEqual([]);
  });

  it("rejects a malformed date", () => {
    expect(() => weeklyDates("soon", 2)).toThrow("Bad date");
  });
});
