import { describe, expect, it } from "vitest";
import { problems } from "./validate";

const doc = (...lines: string[]) => lines.join("\r\n") + "\r\n";
const zone = [
  "BEGIN:VTIMEZONE",
  "TZID:America/New_York",
  "BEGIN:STANDARD",
  "DTSTART:19700101T000000",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0500",
  "END:STANDARD",
  "END:VTIMEZONE",
];
const event = [
  "BEGIN:VEVENT",
  "UID:1@example.test",
  "DTSTAMP:20260101T000000Z",
  "DTSTART;TZID=America/New_York:20260101T200000",
  "SUMMARY:A vs B",
  "END:VEVENT",
];
const valid = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//EN",
  ...zone,
  ...event,
  "END:VCALENDAR",
];

describe("problems", () => {
  it("accepts a valid feed", () => {
    expect(problems(doc(...valid))).toEqual([]);
  });

  it("catches line endings and long lines", () => {
    expect(problems(valid.join("\n"))).toEqual(
      expect.arrayContaining([
        "The feed does not end with CRLF.",
        "Line 1 has a bare CR or LF.",
      ]),
    );
    const long = valid.map((l) =>
      l.startsWith("SUMMARY") ? `SUMMARY:${"x".repeat(80)}` : l,
    );
    expect(problems(doc(...long))).toContain(
      "Line 16 is longer than 75 octets.",
    );
  });

  it("catches bad nesting and stray lines", () => {
    expect(
      problems(doc("BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:x", "nonsense")),
    ).toEqual(["Not a content line: nonsense", "VCALENDAR is not closed."]);
    expect(problems(doc("END:VEVENT"))).toEqual([
      "END:VEVENT does not close anything.",
      "The feed is not exactly one VCALENDAR.",
    ]);
  });

  it("catches missing properties, escapes and time zones", () => {
    const broken = doc(
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VTIMEZONE",
      "TZID:Elsewhere",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "DTSTART;TZID=America/New_York:20260101T200000",
      "SUMMARY:A, B; C \\x",
      "LOCATION:tab\u0001",
      "END:VEVENT",
      "END:VCALENDAR",
    );
    expect(problems(broken)).toEqual([
      'SUMMARY has an unescaped ",".',
      "LOCATION has a control character.",
      "VCALENDAR has 0 PRODID, not one.",
      "A VTIMEZONE has no STANDARD or DAYLIGHT observance.",
      "VEVENT has 0 UID, not one.",
      "VEVENT has 0 DTSTAMP, not one.",
      "TZID America/New_York has no VTIMEZONE.",
    ]);
    expect(
      problems(doc(...valid.map((l) => l.replace("A vs B", "A \\x")))),
    ).toEqual(["SUMMARY has a bad escape."]);
  });

  it("names a raw Unicode line separator instead of rejecting the line", () => {
    for (const separator of ["\u0085", "\u2028", "\u2029"]) {
      expect(
        problems(doc(...valid.map((l) => l.replace("A vs B", separator)))),
      ).toEqual(["SUMMARY has a raw line separator."]);
    }
  });
});
