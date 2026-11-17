import { describe, expect, it } from "vitest";
import { forTests } from "./demo-showcase";

const { addDays, localParts, zoned } = forTests;

describe("demo showcase dates", () => {
  it("adds days across a month end", () => {
    expect(addDays("2026-11-28", 7)).toBe("2026-12-05");
    expect(addDays("2026-12-29", 14)).toBe("2027-01-12");
  });

  it("puts an hour on a day in the league's time zone, across DST", () => {
    // Standard time: 7 pm in New York is midnight UTC.
    expect(zoned("2026-12-08", 19, "America/New_York").toISOString()).toBe(
      "2026-12-09T00:00:00.000Z",
    );
    // Daylight time: 7 pm is 11 pm UTC.
    expect(zoned("2027-06-08", 19, "America/New_York").toISOString()).toBe(
      "2027-06-08T23:00:00.000Z",
    );
  });

  it("reads the local date and weekday of an instant", () => {
    // 1 am UTC on Wednesday is still Tuesday evening in New York.
    expect(
      localParts(new Date("2026-11-25T01:00:00Z"), "America/New_York"),
    ).toEqual({ date: "2026-11-24", weekday: 2 });
  });
});
