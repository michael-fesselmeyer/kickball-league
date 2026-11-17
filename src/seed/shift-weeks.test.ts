import { describe, expect, it } from "vitest";
import {
  shiftDate,
  shiftInstant,
  shiftedPollTitle,
  shiftSlug,
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

describe("shiftSlug", () => {
  it("moves the date at the end of an event's address", () => {
    expect(shiftSlug("spring-bowling-night-2027-03-13", 5)).toBe(
      "spring-bowling-night-2027-04-17",
    );
    expect(shiftSlug("season-wrap-party-2026-10-31", 5)).toBe(
      "season-wrap-party-2026-12-05",
    );
  });

  it("leaves an address without a date alone", () => {
    expect(shiftSlug("spring-prom", 5)).toBe("spring-prom");
    expect(shiftSlug("week-2026", 5)).toBe("week-2026");
  });
});

describe("shiftedPollTitle", () => {
  const poll = {
    kind: "weekly" as const,
    category: "mvp" as const,
    gameDay: "2026-11-10",
    seasonName: "Fall 2026",
  };

  it("renames a default weekly title for its new game day", () => {
    expect(shiftedPollTitle({ ...poll, title: "MVP, Tue, Oct 6" }, 5)).toBe(
      "MVP, Tue, Nov 10",
    );
  });

  it("keeps a title someone wrote, and season polls' titles", () => {
    expect(
      shiftedPollTitle({ ...poll, title: "Best catch of the night" }, 5),
    ).toBe("Best catch of the night");
    expect(
      shiftedPollTitle(
        {
          ...poll,
          kind: "season",
          gameDay: null,
          title: "Fall 2026 MVP",
        },
        5,
      ),
    ).toBe("Fall 2026 MVP");
  });
});
