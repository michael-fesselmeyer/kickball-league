import { describe, expect, it } from "vitest";
import { dashboardLines } from "./csv";
import type { DashboardView } from "./view";

const view = (startsAt: Date): DashboardView => ({
  membership: [],
  money: [],
  selected: {
    seasonId: "s1",
    membership: null,
    money: null,
    teams: [],
    events: [
      {
        id: "e1",
        title: "Bowling",
        startsAt,
        signedUp: 10,
        checkedIn: 5,
        turnout: 0.5,
      },
    ],
    checkins: [],
  },
});

describe("dashboardLines", () => {
  it("dates an evening event by the league's calendar, not UTC's", () => {
    // 9 pm on Friday 2026-07-03 in New York is already Saturday in UTC.
    const lines = dashboardLines(
      view(new Date("2026-07-04T01:00:00Z")),
      "Summer",
      "America/New_York",
    );
    expect(lines[0]?.item).toBe("Bowling (2026-07-03)");
  });

  it("dates an event on New Year's Eve in the year it happens", () => {
    const lines = dashboardLines(
      view(new Date("2027-01-01T03:30:00Z")),
      "Winter",
      "America/New_York",
    );
    expect(lines[0]?.item).toBe("Bowling (2026-12-31)");
  });
});
