import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { LOOKBACK_MS, scoreRemindersDue } from "./score-reminders";

const ENDS = new Date("2026-09-14T00:00:00Z");
const after = (minutes: number) => new Date(ENDS.getTime() + minutes * 60_000);

describe("scoreRemindersDue", () => {
  it("reminds the ref after 30 minutes and captains after 2 hours", () => {
    expect(scoreRemindersDue(ENDS, after(29))).toEqual({
      referee: false,
      captains: false,
    });
    expect(scoreRemindersDue(ENDS, after(30))).toEqual({
      referee: true,
      captains: false,
    });
    expect(scoreRemindersDue(ENDS, after(120))).toEqual({
      referee: true,
      captains: true,
    });
  });

  it("does not chase games that ended long ago", () => {
    expect(scoreRemindersDue(ENDS, after(LOOKBACK_MS / 60_000 + 1))).toEqual({
      referee: false,
      captains: false,
    });
  });

  it("never reminds captains before the ref is due", () => {
    fc.assert(
      fc.property(fc.integer({ min: -600, max: 5000 }), (m) => {
        const due = scoreRemindersDue(ENDS, after(m));
        if (due.captains) expect(due.referee).toBe(true);
      }),
    );
  });
});
