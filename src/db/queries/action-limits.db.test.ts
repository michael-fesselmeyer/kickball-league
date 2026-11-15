import { afterAll, describe, expect, it } from "vitest";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  ACTION_LIMITS,
  type LimitedAction,
  withinActionLimit,
} from "./action-limits";

afterAll(closePool);

const NOW = new Date("2027-04-05T20:00:00Z");
const ACTIONS: readonly LimitedAction[] = [
  "checkout",
  "team_invite",
  "score_report",
  "waitlist",
  "concern",
];
const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

describe("withinActionLimit", () => {
  it("allows each action up to its limit, per subject, then again after its window", async () => {
    await inRolledBackDb(async (db) => {
      for (const action of ACTIONS) {
        const { max, windowSeconds } = ACTION_LIMITS[action];
        const subject = `subject-${action}`;
        const answers = [];
        for (let i = 0; i <= max; i += 1)
          answers.push(await withinActionLimit(db, action, subject, NOW));
        expect(answers.filter(Boolean)).toHaveLength(max);
        expect(answers.at(-1)).toBe(false);
        // Someone else, or another action, has their own count.
        expect(await withinActionLimit(db, action, `${subject}-2`, NOW)).toBe(
          true,
        );
        expect(
          await withinActionLimit(
            db,
            action,
            subject,
            later(windowSeconds + 1),
          ),
        ).toBe(true);
      }
    });
  });
});
