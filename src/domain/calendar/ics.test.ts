import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildCalendar,
  escapeText,
  foldLine,
  localStamp,
  offsetTransitions,
  utcStamp,
  vtimezone,
} from "./ics";
import { problems, unfold } from "./validate";

const NY = "America/New_York";
const octets = (s: string) => new TextEncoder().encode(s).length;

describe("escapeText", () => {
  it("escapes backslashes, semicolons, commas and newlines", () => {
    expect(escapeText("a\\b;c,d\ne\r\nf")).toBe("a\\\\b\\;c\\,d\\ne\\nf");
  });

  it("writes Unicode line breaks as an escaped newline", () => {
    expect(escapeText("a\u2028b\u2029c\u0085d")).toBe("a\\nb\\nc\\nd");
  });
});

describe("foldLine", () => {
  it("leaves short lines alone", () => {
    expect(foldLine("SUMMARY:Short")).toBe("SUMMARY:Short");
  });

  it("folds long lines to 75 octets with a leading space", () => {
    const line = `DESCRIPTION:${"x".repeat(200)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(octets(p)).toBeLessThanOrEqual(75);
    for (const p of parts.slice(1)) expect(p.startsWith(" ")).toBe(true);
    expect(unfold(folded)).toEqual([line]);
  });

  it("never splits a multi-byte character, and unfolds to the original", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 300 }), (s) => {
        const line = `SUMMARY:${s}`;
        const folded = foldLine(line);
        for (const p of folded.split("\r\n"))
          expect(octets(p)).toBeLessThanOrEqual(75);
        expect(unfold(folded)).toEqual([line]);
      }),
    );
  });
});

describe("timestamps", () => {
  it("writes UTC and local wall-clock stamps", () => {
    const kickoff = new Date("2026-09-15T00:00:00Z"); // 8 pm in New York
    expect(utcStamp(kickoff)).toBe("20260915T000000Z");
    expect(localStamp(kickoff, NY)).toBe("20260914T200000");
    expect(localStamp(new Date("2026-12-01T01:30:00Z"), NY)).toBe(
      "20261130T203000",
    );
  });
});

describe("offsetTransitions", () => {
  it("finds New York's 2026 changes to the minute", () => {
    const changes = offsetTransitions(
      NY,
      new Date("2026-01-01T00:00:00Z"),
      new Date("2027-01-01T00:00:00Z"),
    );
    expect(changes.map((c) => [c.at.toISOString(), c.from, c.to])).toEqual([
      ["2026-03-08T07:00:00.000Z", -300, -240],
      ["2026-11-01T06:00:00.000Z", -240, -300],
    ]);
  });

  it("finds none in a zone without daylight saving", () => {
    expect(
      offsetTransitions(
        "Asia/Kolkata",
        new Date("2026-01-01T00:00:00Z"),
        new Date("2027-01-01T00:00:00Z"),
      ),
    ).toEqual([]);
  });
});

describe("vtimezone", () => {
  it("covers the year before and every change through the last year", () => {
    const lines = vtimezone(
      NY,
      new Date("2026-09-15T00:00:00Z"),
      new Date("2026-11-20T00:00:00Z"),
    );
    expect(lines[0]).toBe("BEGIN:VTIMEZONE");
    expect(lines).toContain("TZID:America/New_York");
    // 2025 and 2026: four changes, onsets in the old offset's wall clock.
    expect(lines.filter((l) => l.startsWith("DTSTART:"))).toEqual([
      "DTSTART:20250309T020000",
      "DTSTART:20251102T020000",
      "DTSTART:20260308T020000",
      "DTSTART:20261101T020000",
    ]);
    expect(lines).toContain("TZNAME:EDT");
    expect(lines).toContain("TZNAME:EST");
    expect(lines.filter((l) => l === "BEGIN:DAYLIGHT")).toHaveLength(2);
  });

  it("writes one fixed offset for a zone that never changes", () => {
    const lines = vtimezone(
      "Asia/Kolkata",
      new Date("2026-06-01T00:00:00Z"),
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(lines).toEqual([
      "BEGIN:VTIMEZONE",
      "TZID:Asia/Kolkata",
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:+0530",
      "TZOFFSETTO:+0530",
      expect.stringMatching(/^TZNAME:/),
      "END:STANDARD",
      "END:VTIMEZONE",
    ]);
  });
});

describe("buildCalendar", () => {
  const generatedAt = new Date("2026-09-01T12:00:00Z");
  const event = {
    uid: "game-1@kickball-league",
    start: new Date("2026-09-15T00:00:00Z"),
    end: new Date("2026-09-15T00:55:00Z"),
    summary: "Kickers vs Sluggers",
    location: "Field 2, Riverside Park, 1 Park Ave",
    description: "Fall 2026, round 3\nGame page: https://example.test/games/1",
    url: "https://example.test/games/1",
    geo: { lat: 40.72, lng: -73.95 },
    sequence: 2,
  };

  it("writes a valid calendar with times in the league's zone", () => {
    const ics = buildCalendar({
      name: "Kickers games",
      description: "Games, always current",
      timeZone: NY,
      generatedAt,
      events: [event],
    });
    expect(problems(ics)).toEqual([]);
    const lines = unfold(ics);
    expect(lines).toEqual(
      expect.arrayContaining([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Kickers games",
        "X-WR-TIMEZONE:America/New_York",
        "X-WR-CALDESC:Games\\, always current",
        "REFRESH-INTERVAL;VALUE=DURATION:PT60M",
        "UID:game-1@kickball-league",
        "DTSTAMP:20260901T120000Z",
        "DTSTART;TZID=America/New_York:20260914T200000",
        "DTEND;TZID=America/New_York:20260914T205500",
        "LOCATION:Field 2\\, Riverside Park\\, 1 Park Ave",
        "GEO:40.720000;-73.950000",
        "DESCRIPTION:Fall 2026\\, round 3\\nGame page: https://example.test/games/1",
        "STATUS:CONFIRMED",
        "SEQUENCE:2",
      ]),
    );
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("writes a valid empty calendar", () => {
    const ics = buildCalendar({
      name: "Nobody",
      timeZone: NY,
      generatedAt,
      events: [],
      refreshMinutes: 30,
    });
    expect(problems(ics)).toEqual([]);
    expect(unfold(ics)).toContain("X-PUBLISHED-TTL:PT30M");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("writes a minimal event with only the required fields", () => {
    const ics = buildCalendar({
      name: "Minimal",
      timeZone: NY,
      generatedAt,
      events: [
        {
          uid: "x@kickball-league",
          start: event.start,
          end: event.end,
          summary: "Game",
          status: "CANCELLED",
        },
      ],
    });
    expect(problems(ics)).toEqual([]);
    const lines = unfold(ics);
    expect(lines).toContain("STATUS:CANCELLED");
    expect(lines.some((l) => l.startsWith("LOCATION"))).toBe(false);
    expect(lines.some((l) => l.startsWith("SEQUENCE"))).toBe(false);
  });

  it("stays valid for a summary that is a Unicode line separator", () => {
    // The property below found this: many parsers end a line at U+2028.
    const ics = buildCalendar({
      name: "\u2028",
      timeZone: NY,
      generatedAt,
      events: [{ ...event, summary: "\u2028", location: "" }],
    });
    expect(problems(ics)).toEqual([]);
    expect(unfold(ics)).toEqual(
      expect.arrayContaining(["X-WR-CALNAME:\\n", "SUMMARY:\\n"]),
    );
  });

  it("stays valid for any summary and location text", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: "grapheme", maxLength: 120 }),
        fc.string({ maxLength: 120 }),
        (summary, location) => {
          const ics = buildCalendar({
            name: summary,
            timeZone: NY,
            generatedAt,
            events: [{ ...event, summary, location }],
          });
          expect(problems(ics)).toEqual([]);
        },
      ),
      { numRuns: 50 },
    );
  });
});
