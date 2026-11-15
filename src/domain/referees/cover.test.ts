import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AssignGame, Commitment } from "./assign";
import {
  ASK_WINDOW_MS,
  canDrop,
  DROP_REASON_MAX,
  parseDropReason,
  whoToAsk,
  withinAskWindow,
} from "./cover";

const HOUR = 3_600_000;
const T = Date.UTC(2026, 9, 13, 23);
const LENGTH = 50 * 60_000;

const game: AssignGame = {
  id: "g",
  startsAt: T,
  endsAt: T + LENGTH,
  fieldId: "f1",
  teamSeasonIds: ["t1", "t2"],
};

const overlaps = (c: Commitment) =>
  c.startsAt < game.endsAt && game.startsAt < c.endsAt;

describe("whoToAsk", () => {
  const world = fc.record({
    refs: fc.uniqueArray(
      fc.record({
        id: fc.constantFrom("a", "b", "c", "d", "e", "f"),
        teams: fc.subarray(["t1", "t2", "t3", "t4"]),
      }),
      { selector: (r) => r.id, maxLength: 6 },
    ),
    commitments: fc.array(
      fc.record({
        refId: fc.constantFrom("a", "b", "c", "d", "e", "f"),
        slot: fc.integer({ min: -2, max: 2 }),
        fieldId: fc.constantFrom("f1", "f2"),
        counts: fc.boolean(),
      }),
      { maxLength: 8 },
    ),
    exclude: fc.subarray(["a", "b", "c", "d", "e", "f"]),
  });
  type World = typeof world extends fc.Arbitrary<infer V> ? V : never;
  const run = (w: World) => {
    const refs = w.refs.map((r) => ({
      id: r.id,
      teamSeasonIds: new Set(r.teams),
    }));
    const commitments: Commitment[] = w.commitments.map((c) => ({
      refId: c.refId,
      startsAt: T + c.slot * HOUR,
      endsAt: T + c.slot * HOUR + LENGTH,
      fieldId: c.fieldId,
      counts: c.counts,
    }));
    const asked = whoToAsk({
      game,
      refs,
      commitments,
      exclude: new Set(w.exclude),
    });
    return { refs, commitments, asked };
  };

  it("never asks someone playing in it, playing or reffing then, or excluded; asks everyone else once", () => {
    fc.assert(
      fc.property(world, (w) => {
        const { refs, commitments, asked } = run(w);
        expect(new Set(asked).size).toBe(asked.length);
        for (const r of refs) {
          const plays = game.teamSeasonIds.some((t) => r.teamSeasonIds.has(t));
          const busy = commitments.some((c) => c.refId === r.id && overlaps(c));
          const shouldAsk = !plays && !busy && !w.exclude.includes(r.id);
          expect(asked.includes(r.id)).toBe(shouldAsk);
        }
      }),
    );
  });

  it("asks a ref who plays on another field just before, unlike the assigner", () => {
    expect(
      whoToAsk({
        game,
        refs: [{ id: "a", teamSeasonIds: new Set(["t3"]) }],
        commitments: [
          {
            refId: "a",
            startsAt: T - HOUR,
            endsAt: T - HOUR + LENGTH,
            fieldId: "f2",
            counts: false,
          },
        ],
      }),
    ).toEqual(["a"]);
  });
});

describe("the window and dropping", () => {
  it("asks only for games that start within a day", () => {
    const now = new Date(T);
    expect(withinAskWindow(new Date(T + ASK_WINDOW_MS), now)).toBe(true);
    expect(withinAskWindow(new Date(T + ASK_WINDOW_MS + 1), now)).toBe(false);
    expect(withinAskWindow(new Date(T), now)).toBe(false);
    expect(canDrop(new Date(T + 1), now)).toBe(true);
    expect(canDrop(new Date(T), now)).toBe(false);
  });

  it("takes a short reason and refuses an empty or long one", () => {
    expect(parseDropReason("  Sick,\n sorry  ")).toBe("Sick, sorry");
    expect(parseDropReason("   ")).toBeNull();
    expect(parseDropReason(null)).toBeNull();
    expect(parseDropReason("x".repeat(DROP_REASON_MAX))).toHaveLength(
      DROP_REASON_MAX,
    );
    expect(parseDropReason("x".repeat(DROP_REASON_MAX + 1))).toBeNull();
  });
});
