import { describe, expect, it } from "vitest";
import {
  shiftDate,
  shiftInstant,
  shiftSnapshot,
  weeksToCatchUp,
} from "./shift-weeks";

const NY = "America/New_York";

describe("weeksToCatchUp", () => {
  it("moves the next game day to today or the first one after it", () => {
    // Next game Tue Sep 22; on Sat Nov 14 that's 53 days back: 8 weeks
    // makes it Tue Nov 17.
    expect(weeksToCatchUp("2026-09-22", "2026-11-14")).toBe(8);
    // On the game day itself, nothing to skip past.
    expect(weeksToCatchUp("2026-11-17", "2026-11-17")).toBe(0);
    // A day late is a week's move.
    expect(weeksToCatchUp("2026-11-17", "2026-11-18")).toBe(1);
    expect(weeksToCatchUp("2026-12-01", "2026-11-14")).toBe(0);
  });
});

describe("shifting by weeks", () => {
  it("keeps the local time across a daylight-saving change", () => {
    // Tue Sep 15, 8 pm EDT (UTC-4) → Tue Nov 17, 8 pm EST (UTC-5).
    expect(shiftInstant("2026-09-16T00:00:00.000Z", 9, NY)).toBe(
      "2026-11-18T01:00:00.000Z",
    );
    // And back into summer time: Tue Mar 2, 8 pm EST → Tue Mar 16, 8 pm EDT.
    expect(shiftInstant("2027-03-03T01:00:00.000Z", 2, NY)).toBe(
      "2027-03-17T00:00:00.000Z",
    );
  });

  it("keeps the weekday of a date", () => {
    expect(shiftDate("2026-09-15", 9)).toBe("2026-11-17");
    expect(shiftDate("2026-12-29", 1)).toBe("2027-01-05");
  });

  it("moves a schedule snapshot's slots and conflict dates, and nothing else", () => {
    const snapshot = {
      rounds: 7,
      slots: [
        {
          id: "s1",
          date: "2026-09-15",
          startsAt: "2026-09-16T00:00:00.000Z",
          endsAt: "2026-09-16T00:55:00.000Z",
          timeIndex: 0,
        },
      ],
      constraints: [
        { teamId: "t1", kind: "unavailable", date: "2026-09-22" },
        { teamId: "t2", kind: "prefer", timeIndex: 1 },
      ],
    };
    expect(shiftSnapshot(snapshot, 9, NY)).toEqual({
      rounds: 7,
      slots: [
        {
          id: "s1",
          date: "2026-11-17",
          startsAt: "2026-11-18T01:00:00.000Z",
          endsAt: "2026-11-18T01:55:00.000Z",
          timeIndex: 0,
        },
      ],
      constraints: [
        { teamId: "t1", kind: "unavailable", date: "2026-11-24" },
        { teamId: "t2", kind: "prefer", timeIndex: 1 },
      ],
    });
  });
});
