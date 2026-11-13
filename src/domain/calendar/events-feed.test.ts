import { describe, expect, it } from "vitest";
import { eventsFeed, type FeedEvent, leagueEvent } from "./events-feed";

const ORIGIN = "https://league.example.test";

const bbq: FeedEvent = {
  id: "e7e00000-0000-4000-8000-000000000006",
  slug: "spring-kickoff-bbq-2027-04-10",
  kind: "bbq",
  title: "Spring kickoff BBQ",
  place: "McCarren Park, north picnic area",
  description: "Burgers, veggie dogs and lawn games.",
  startsAt: new Date("2027-04-10T16:00:00Z"),
  endsAt: new Date("2027-04-10T20:00:00Z"),
  cancelledAt: null,
};

const costumes: FeedEvent = {
  id: "e7e00000-0000-4000-8000-000000000002",
  slug: "costume-week-2026-10-26",
  kind: "theme_week",
  title: "Costume week",
  place: null,
  description: "",
  startsAt: new Date("2026-10-26T04:00:00Z"),
  endsAt: new Date("2026-11-02T05:00:00Z"),
  cancelledAt: null,
};

describe("leagueEvent", () => {
  it("links the event page and keeps a stable id", () => {
    expect(leagueEvent(bbq, ORIGIN)).toEqual({
      uid: "event-e7e00000-0000-4000-8000-000000000006@kickball-league",
      start: bbq.startsAt,
      end: bbq.endsAt,
      summary: "Spring kickoff BBQ",
      description: `Burgers, veggie dogs and lawn games.\n\nEvent page: ${ORIGIN}/events/spring-kickoff-bbq-2027-04-10`,
      url: `${ORIGIN}/events/spring-kickoff-bbq-2027-04-10`,
      status: "CONFIRMED",
      location: "McCarren Park, north picnic area",
    });
  });

  it("marks a called-off event", () => {
    const entry = leagueEvent({ ...bbq, cancelledAt: new Date() }, ORIGIN);
    expect(entry.status).toBe("CANCELLED");
    expect(entry.summary).toBe("Called off: Spring kickoff BBQ");
  });

  it("makes a theme week an all-day entry", () => {
    const entry = leagueEvent(costumes, ORIGIN);
    expect(entry.allDay).toBe(true);
    expect(entry.summary).toBe("Theme week: Costume week");
    expect(entry).not.toHaveProperty("location");
  });
});

describe("eventsFeed", () => {
  const feed = eventsFeed({
    name: "Kickball League events",
    timeZone: "America/New_York",
    origin: ORIGIN,
    events: [costumes, bbq],
    now: new Date("2026-11-12T12:00:00Z"),
  });
  const lines = feed.split("\r\n");

  it("writes timed events in the league's zone", () => {
    expect(lines).toContain("DTSTART;TZID=America/New_York:20270410T120000");
    expect(lines).toContain("DTEND;TZID=America/New_York:20270410T160000");
  });

  it("writes theme weeks as whole days that don't block time", () => {
    const start = lines.indexOf("DTSTART;VALUE=DATE:20261026");
    expect(start).toBeGreaterThan(0);
    expect(lines[start + 1]).toBe("DTEND;VALUE=DATE:20261102");
    expect(lines).toContain("TRANSP:TRANSPARENT");
  });

  it("names the calendar and asks apps to check a few times a day", () => {
    expect(lines).toContain("X-WR-CALNAME:Kickball League events");
    expect(lines).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT360M");
  });
});
