import { describe, expect, it } from "vitest";
import {
  clockText,
  dayText,
  localDate,
  parkDays,
  rangeText,
  type ParkWindow,
} from "./field-hours";

const NY = "America/New_York";

const win = (
  fieldName: string,
  startsAt: string,
  endsAt: string,
  permitNumber: string | null = "B-123",
  sortOrder = 0,
): ParkWindow => ({
  fieldId: `id-${fieldName}`,
  fieldName,
  sortOrder,
  startsAt: new Date(startsAt),
  endsAt: new Date(endsAt),
  permitNumber,
});

describe("local dates and clock times", () => {
  it("reads the league's wall clock, not UTC", () => {
    // 01:00 UTC on Nov 17 is still the evening of Nov 16 in New York.
    expect(localDate(new Date("2026-11-17T01:00:00Z"), NY)).toBe("2026-11-16");
    expect(clockText(new Date("2026-11-17T01:00:00Z"), NY)).toBe("8:00 PM");
    expect(clockText(new Date("2026-11-17T05:00:00Z"), NY)).toBe("12:00 AM");
    expect(clockText(new Date("2026-07-04T16:30:00Z"), NY)).toBe("12:30 PM");
  });

  it("names a date by its weekday", () => {
    expect(dayText("2026-11-17")).toBe("Tuesday, November 17");
  });
});

describe("parkDays", () => {
  const now = new Date("2026-11-17T15:00:00Z");

  it("leaves out windows that are over and keeps one under way", () => {
    const days = parkDays(
      [
        win("Field 1", "2026-11-16T23:00:00Z", "2026-11-17T02:00:00Z"),
        win("Field 1", "2026-11-17T22:00:00Z", "2026-11-18T01:00:00Z"),
        win("Field 1", "2026-11-17T12:00:00Z", "2026-11-17T16:00:00Z"),
      ],
      now,
      NY,
      14,
    );
    expect(days.map((d) => d.date)).toEqual(["2026-11-17"]);
    expect(days[0]?.fields.map((f) => rangeText(f, NY))).toEqual([
      "7:00 AM to 11:00 AM",
      "5:00 PM to 8:00 PM",
    ]);
  });

  it("is empty on a day with no permit", () => {
    expect(parkDays([], now, NY, 14)).toEqual([]);
    expect(
      parkDays(
        [win("Field 1", "2026-11-10T22:00:00Z", "2026-11-11T01:00:00Z")],
        now,
        NY,
        14,
      ),
    ).toEqual([]);
  });

  it("keeps a window that runs past midnight on the day it starts", () => {
    const [day] = parkDays(
      [win("Field 2", "2026-11-18T01:00:00Z", "2026-11-18T06:00:00Z")],
      now,
      NY,
      14,
    );
    expect(day?.date).toBe("2026-11-17");
    const f = day?.fields[0];
    expect(f?.endsNextDay).toBe(true);
    expect(f && rangeText(f, NY)).toBe("8:00 PM to 1:00 AM (next day)");
  });

  it("shows the clock right across the fall-back change", () => {
    // Saturday Oct 31 8 pm EDT to 1 am EST on Nov 1: the night is five
    // hours on the clock but six elapsed.
    const [day] = parkDays(
      [win("Field 1", "2026-11-01T00:00:00Z", "2026-11-01T06:00:00Z")],
      new Date("2026-10-30T12:00:00Z"),
      NY,
      14,
    );
    expect(day?.date).toBe("2026-10-31");
    const f = day?.fields[0];
    expect(f && rangeText(f, NY)).toBe("8:00 PM to 1:00 AM (next day)");
  });

  it("merges windows that touch and keeps every permit number", () => {
    const [day] = parkDays(
      [
        win("Field 1", "2026-11-17T22:00:00Z", "2026-11-18T00:00:00Z", "B-1"),
        win("Field 1", "2026-11-18T00:00:00Z", "2026-11-18T02:00:00Z", "B-2"),
        win("Field 1", "2026-11-18T00:00:00Z", "2026-11-18T01:00:00Z", "B-2"),
      ],
      now,
      NY,
      14,
    );
    expect(day?.fields).toHaveLength(1);
    expect(day?.fields[0]?.permitNumbers).toEqual(["B-1", "B-2"]);
    const f = day?.fields[0];
    expect(f && rangeText(f, NY)).toBe("5:00 PM to 9:00 PM");
  });

  it("lists a field with no recorded permit number without one", () => {
    const [day] = parkDays(
      [win("Field 1", "2026-11-17T22:00:00Z", "2026-11-18T00:00:00Z", null)],
      now,
      NY,
      14,
    );
    expect(day?.fields[0]?.permitNumbers).toEqual([]);
  });

  it("orders fields by their place in the park and limits the days", () => {
    const days = parkDays(
      [
        win("North", "2026-11-17T22:00:00Z", "2026-11-18T00:00:00Z", "B", 1),
        win("South", "2026-11-17T22:00:00Z", "2026-11-18T00:00:00Z", "B", 0),
        win("South", "2026-11-24T22:00:00Z", "2026-11-25T00:00:00Z", "B", 0),
      ],
      now,
      NY,
      1,
    );
    expect(days).toHaveLength(1);
    expect(days[0]?.fields.map((f) => f.fieldName)).toEqual(["South", "North"]);
  });
});
