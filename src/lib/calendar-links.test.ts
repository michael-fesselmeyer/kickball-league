import { describe, expect, it } from "vitest";
import {
  calendarLinks,
  eventsCalendarLinks,
  googleEventLink,
  requestOrigin,
} from "./calendar-links";

describe("calendarLinks", () => {
  it("gives the feed, a webcal link and a Google subscribe link", () => {
    expect(
      calendarLinks(
        "https://example.test",
        { slug: "kickball", isDefault: true },
        "the-big-kicks",
      ),
    ).toEqual({
      feed: "https://example.test/teams/the-big-kicks/calendar.ics",
      webcal: "webcal://example.test/teams/the-big-kicks/calendar.ics",
      google:
        "https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2Fexample.test%2Fteams%2Fthe-big-kicks%2Fcalendar.ics",
    });
  });
});

describe("requestOrigin", () => {
  it("prefers forwarded headers", () => {
    expect(
      requestOrigin(
        new Headers({
          host: "internal:3000",
          "x-forwarded-host": "league.example.test",
          "x-forwarded-proto": "https, http",
        }),
      ),
    ).toBe("https://league.example.test");
  });

  it("assumes http for a local host and https otherwise", () => {
    expect(requestOrigin(new Headers({ host: "localhost:3001" }))).toBe(
      "http://localhost:3001",
    );
    expect(requestOrigin(new Headers({ host: "example.test" }))).toBe(
      "https://example.test",
    );
    expect(requestOrigin(new Headers())).toBe("http://localhost");
  });
});

describe("eventsCalendarLinks", () => {
  it("subscribes to the league's events feed", () => {
    expect(
      eventsCalendarLinks("https://league.example.test", {
        slug: "kickball",
        isDefault: true,
      }),
    ).toEqual({
      feed: "https://league.example.test/events/calendar.ics",
      webcal: "webcal://league.example.test/events/calendar.ics",
      google:
        "https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2Fleague.example.test%2Fevents%2Fcalendar.ics",
    });
  });
});

describe("googleEventLink", () => {
  it("adds a timed event in UTC", () => {
    const url = new URL(
      googleEventLink({
        title: "Trivia & tacos",
        details: "Teams of four.",
        place: "Quiz Hall, 1 Example St",
        start: new Date("2027-03-06T00:00:00Z"),
        end: new Date("2027-03-06T02:30:00Z"),
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://calendar.google.com/calendar/render",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: "TEMPLATE",
      text: "Trivia & tacos",
      dates: "20270306T000000Z/20270306T023000Z",
      details: "Teams of four.",
      location: "Quiz Hall, 1 Example St",
    });
  });

  it("adds whole days for a theme week, with no place", () => {
    const url = new URL(
      googleEventLink({
        title: "Costume week",
        details: "",
        place: null,
        start: new Date("2026-10-26T04:00:00Z"),
        end: new Date("2026-11-02T05:00:00Z"),
        allDay: { first: "2026-10-26", afterLast: "2026-11-02" },
      }),
    );
    expect(url.searchParams.get("dates")).toBe("20261026/20261102");
    expect(url.searchParams.has("location")).toBe(false);
  });
});

describe("feeds of a league other than the default (ADR 0048)", () => {
  it("carry its /l/<slug> prefix", () => {
    const football = { slug: "flag-football", isDefault: false };
    expect(
      calendarLinks("https://example.test", football, "hail-marys").feed,
    ).toBe(
      "https://example.test/l/flag-football/teams/hail-marys/calendar.ics",
    );
    expect(eventsCalendarLinks("https://example.test", football).feed).toBe(
      "https://example.test/l/flag-football/events/calendar.ics",
    );
  });
});
