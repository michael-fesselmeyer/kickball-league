import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { daysUntil, dueReminder } from "./payment-reminders";

const ZONE = "America/New_York";
// Deadline: Friday 2026-09-11 at 23:59 in New York.
const DEADLINE = new Date("2026-09-12T03:59:00Z");
/** 10:00 New York time on the given September day. */
const at = (day: number) =>
  new Date(`2026-09-${String(day).padStart(2, "0")}T14:00:00Z`);

describe("daysUntil", () => {
  it("counts calendar days in the league's zone", () => {
    expect(daysUntil(DEADLINE, at(4), ZONE)).toBe(7);
    expect(daysUntil(DEADLINE, at(11), ZONE)).toBe(0);
    // 22:00 on the 10th in New York is already the 11th in UTC.
    expect(daysUntil(DEADLINE, new Date("2026-09-11T02:00:00Z"), ZONE)).toBe(1);
  });
});

describe("dueReminder", () => {
  it("is due 7, 3 and 1 days before, and the closest one in between", () => {
    const due = (day: number) => dueReminder(DEADLINE, at(day), ZONE);
    expect(due(3)).toBeNull();
    expect(due(4)).toEqual({ milestone: 7, daysLeft: 7 });
    expect(due(7)).toEqual({ milestone: 7, daysLeft: 4 });
    expect(due(8)).toEqual({ milestone: 3, daysLeft: 3 });
    expect(due(9)).toEqual({ milestone: 3, daysLeft: 2 });
    expect(due(10)).toEqual({ milestone: 1, daysLeft: 1 });
    expect(due(11)).toEqual({ milestone: 1, daysLeft: 0 });
  });

  it("stops once the deadline has passed", () => {
    expect(dueReminder(DEADLINE, DEADLINE, ZONE)).toBeNull();
    expect(dueReminder(DEADLINE, at(12), ZONE)).toBeNull();
  });

  it("never names a milestone sooner than the days left", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30 * 24 }), (hours) => {
        const now = new Date(DEADLINE.getTime() - hours * 3_600_000 - 1);
        const due = dueReminder(DEADLINE, now, ZONE);
        if (due) expect(due.milestone).toBeGreaterThanOrEqual(due.daysLeft);
        else expect(daysUntil(DEADLINE, now, ZONE)).toBeGreaterThan(7);
      }),
    );
  });
});
