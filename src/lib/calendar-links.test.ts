import { describe, expect, it } from "vitest";
import { calendarLinks, requestOrigin } from "./calendar-links";

describe("calendarLinks", () => {
  it("gives the feed, a webcal link and a Google subscribe link", () => {
    expect(calendarLinks("https://example.test", "the-big-kicks")).toEqual({
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
