import { describe, expect, it } from "vitest";
import { dayHeading, fullWhen, kickoff, shortDay } from "./format";

const NY = "America/New_York";
// 8 pm Monday in New York is already Tuesday in UTC.
const monday8pm = new Date("2026-09-15T00:00:00Z");

describe("format", () => {
  it("writes times in the league's zone, not the server's", () => {
    expect(dayHeading("2026-09-14")).toBe("Monday, September 14");
    expect(kickoff(monday8pm, NY)).toBe("8:00 PM");
    expect(shortDay(monday8pm, NY)).toBe("Mon, Sep 14");
    expect(fullWhen(monday8pm, NY)).toBe(
      "Monday, September 14, 2026 at 8:00 PM EDT",
    );
  });
});
