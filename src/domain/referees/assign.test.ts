import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  allowed,
  type AssignGame,
  type AssignRef,
  BACK_TO_BACK_MS,
  type Commitment,
  fits,
  type Proposal,
  proposeReferees,
} from "./assign";

const HOUR = 3_600_000;
/** A game day's first slot, and a day a week before it. */
const DAY = Date.UTC(2026, 8, 13, 22);
const WEEK_BEFORE = DAY - 7 * 24 * HOUR;
/** Games run 50 minutes, so slots an hour apart are back to back. */
const LENGTH = 50 * 60_000;

type World = {
  games: AssignGame[];
  refs: AssignRef[];
  commitments: Commitment[];
};

/**
 * A game day: up to 4 hourly slots on up to 3 fields, games between 8
 * teams, and up to 6 refs, each available for some slots, maybe on a team,
 * maybe with games already worked earlier in the season or that day.
 */
const worlds: fc.Arbitrary<World> = fc
  .record({
    times: fc.integer({ min: 1, max: 4 }),
    fields: fc.integer({ min: 1, max: 3 }),
  })
  .chain(({ times, fields }) => {
    const cells = Array.from({ length: times * fields }, (_, i) => ({
      time: Math.floor(i / fields),
      field: i % fields,
    }));
    const matchup = fc
      .tuple(fc.integer({ min: 0, max: 7 }), fc.integer({ min: 0, max: 7 }))
      .filter(([a, b]) => a !== b);
    const ref = fc.record({
      available: fc.subarray(Array.from({ length: times }, (_, t) => t)),
      team: fc.option(fc.integer({ min: 0, max: 7 }), { nil: undefined }),
      earlier: fc.nat({ max: 3 }),
      sameDay: fc.option(fc.constantFrom(...cells), { nil: undefined }),
    });
    return fc.record({
      placed: fc.subarray(cells),
      matchups: fc.array(matchup, {
        minLength: cells.length,
        maxLength: cells.length,
      }),
      refs: fc.array(ref, { maxLength: 6 }),
    });
  })
  .map(({ placed, matchups, refs }) => {
    const at = (time: number) => DAY + time * HOUR;
    const games = placed.map((c, i): AssignGame => {
      const [a, b] = matchups[i] ?? [0, 1];
      return {
        id: `g${i}`,
        startsAt: at(c.time),
        endsAt: at(c.time) + LENGTH,
        fieldId: `f${c.field}`,
        teamSeasonIds: [`t${a}`, `t${b}`],
      };
    });
    const commitments: Commitment[] = refs.flatMap((r, i) => [
      // Games already worked earlier in the season.
      ...Array.from({ length: r.earlier }, (_, k) => ({
        refId: `r${i}`,
        startsAt: WEEK_BEFORE + k * HOUR,
        endsAt: WEEK_BEFORE + k * HOUR + LENGTH,
        fieldId: "f0",
        counts: true,
      })),
      // A game already theirs today, outside this run.
      ...(r.sameDay
        ? [
            {
              refId: `r${i}`,
              startsAt: at(r.sameDay.time),
              endsAt: at(r.sameDay.time) + LENGTH,
              fieldId: `f${r.sameDay.field}`,
              counts: true,
            },
          ]
        : []),
      // Their own team's games today.
      ...games
        .filter(
          (g) => r.team !== undefined && g.teamSeasonIds.includes(`t${r.team}`),
        )
        .map((g) => ({
          refId: `r${i}`,
          startsAt: g.startsAt,
          endsAt: g.endsAt,
          fieldId: g.fieldId,
          counts: false,
        })),
    ]);
    return {
      games,
      refs: refs.map((r, i): AssignRef => ({
        id: `r${i}`,
        available: new Set(r.available.map(at)),
        teamSeasonIds: new Set(r.team === undefined ? [] : [`t${r.team}`]),
      })),
      commitments,
    };
  });

// The checks below restate each promise on their own, without the
// assigner's helpers, so a bug in those can't hide here.

type Span = { startsAt: number; endsAt: number; fieldId: string };

/** Everything a ref does once the proposal is accepted. */
function dayOf(w: World, p: Proposal, refId: string, except?: string): Span[] {
  return [
    ...w.commitments.filter((c) => c.refId === refId),
    ...w.games.filter(
      (g) => g.id !== except && p.assignments.get(g.id) === refId,
    ),
  ];
}

const clash = (a: Span, b: Span) =>
  a.startsAt < b.endsAt && b.startsAt < a.endsAt;
const crossesFields = (a: Span, b: Span) => {
  const gap =
    a.startsAt >= b.endsAt ? a.startsAt - b.endsAt : b.startsAt - a.endsAt;
  return !clash(a, b) && gap < BACK_TO_BACK_MS && a.fieldId !== b.fieldId;
};

function couldTake(w: World, p: Proposal, ref: AssignRef, game: AssignGame) {
  return (
    ref.available.has(game.startsAt) &&
    !game.teamSeasonIds.some((t) => ref.teamSeasonIds.has(t)) &&
    dayOf(w, p, ref.id, game.id).every(
      (s) => !clash(s, game) && !crossesFields(s, game),
    )
  );
}

function shares(w: World, p: Proposal) {
  return new Map(
    w.refs.map((r) => [
      r.id,
      w.commitments.filter((c) => c.refId === r.id && c.counts).length +
        [...p.assignments.values()].filter((id) => id === r.id).length,
    ]),
  );
}

const RUNS = { numRuns: 300 };

describe("proposeReferees", () => {
  it("proposes a ref only at a time they said they can work", () => {
    fc.assert(
      fc.property(worlds, (w) => {
        const p = proposeReferees(w);
        for (const g of w.games) {
          const refId = p.assignments.get(g.id);
          if (refId)
            expect(
              w.refs.find((r) => r.id === refId)?.available.has(g.startsAt),
            ).toBe(true);
        }
      }),
      RUNS,
    );
  });

  it("never proposes a ref for a game their own team plays", () => {
    fc.assert(
      fc.property(worlds, (w) => {
        const p = proposeReferees(w);
        for (const g of w.games) {
          const ref = w.refs.find((r) => r.id === p.assignments.get(g.id));
          if (ref)
            expect(g.teamSeasonIds.some((t) => ref.teamSeasonIds.has(t))).toBe(
              false,
            );
        }
      }),
      RUNS,
    );
  });

  it("never books a ref twice at once, or while their team plays", () => {
    fc.assert(
      fc.property(worlds, (w) => {
        const p = proposeReferees(w);
        for (const [gameId, refId] of p.assignments) {
          const game = w.games.find((g) => g.id === gameId);
          if (!game) throw new Error("proposed an unknown game");
          for (const other of dayOf(w, p, refId, gameId))
            expect(clash(other, game)).toBe(false);
        }
      }),
      RUNS,
    );
  });

  it("never sends a ref to another field for a back-to-back game", () => {
    fc.assert(
      fc.property(worlds, (w) => {
        const p = proposeReferees(w);
        for (const [gameId, refId] of p.assignments) {
          const game = w.games.find((g) => g.id === gameId);
          if (!game) throw new Error("proposed an unknown game");
          for (const other of dayOf(w, p, refId, gameId))
            expect(crossesFields(other, game)).toBe(false);
        }
      }),
      RUNS,
    );
  });

  it("is fair: no game could go to a free ref with two fewer games", () => {
    fc.assert(
      fc.property(worlds, (w) => {
        const p = proposeReferees(w);
        const share = shares(w, p);
        for (const g of w.games) {
          const from = p.assignments.get(g.id);
          if (!from) continue;
          for (const r of w.refs)
            if (r.id !== from && couldTake(w, p, r, g))
              expect(
                (share.get(from) ?? 0) - (share.get(r.id) ?? 0),
              ).toBeLessThan(2);
        }
        expect(p.loads).toEqual(share);
      }),
      RUNS,
    );
  });

  it("leaves a game without a ref only when nobody could take it", () => {
    fc.assert(
      fc.property(worlds, (w) => {
        const p = proposeReferees(w);
        expect(p.assignments.size + p.unfilled.length).toBe(w.games.length);
        for (const { gameId, reason } of p.unfilled) {
          const game = w.games.find((g) => g.id === gameId);
          if (!game) throw new Error("unfilled an unknown game");
          expect(w.refs.some((r) => couldTake(w, p, r, game))).toBe(false);
          expect(reason).toBe(
            w.refs.some((r) => r.available.has(game.startsAt))
              ? "everyone_busy"
              : "nobody_available",
          );
        }
      }),
      RUNS,
    );
  });

  it("proposes the same whatever order the games and refs come in", () => {
    fc.assert(
      fc.property(worlds, fc.integer(), (w, seed) => {
        const shuffle = <T>(xs: readonly T[]) =>
          xs
            .map((x, i) => ({ x, k: (i * 7919 + seed) % 1009 }))
            .sort((a, b) => a.k - b.k)
            .map(({ x }) => x);
        const p = proposeReferees(w);
        const q = proposeReferees({
          ...w,
          games: shuffle(w.games),
          refs: shuffle(w.refs),
        });
        expect([...q.assignments].sort()).toEqual([...p.assignments].sort());
      }),
      RUNS,
    );
  });

  it("keeps a ref on one field for a block of games", () => {
    // Two refs, two fields, two back-to-back slots: each ref stays put.
    const game = (id: string, hour: number, field: string): AssignGame => ({
      id,
      startsAt: DAY + hour * HOUR,
      endsAt: DAY + hour * HOUR + LENGTH,
      fieldId: field,
      teamSeasonIds: [`${id}-a`, `${id}-b`],
    });
    const both = new Set([DAY, DAY + HOUR]);
    const p = proposeReferees({
      games: [
        game("a1", 0, "f1"),
        game("b1", 0, "f2"),
        game("a2", 1, "f1"),
        game("b2", 1, "f2"),
      ],
      refs: [
        { id: "r1", available: both, teamSeasonIds: new Set() },
        { id: "r2", available: both, teamSeasonIds: new Set() },
      ],
      commitments: [],
    });
    expect(p.assignments.get("a1")).toBe(p.assignments.get("a2"));
    expect(p.assignments.get("b1")).toBe(p.assignments.get("b2"));
    expect(p.unfilled).toEqual([]);
  });

  it("says why a game has nobody", () => {
    const p = proposeReferees({
      games: [
        {
          id: "g",
          startsAt: DAY,
          endsAt: DAY + LENGTH,
          fieldId: "f1",
          teamSeasonIds: ["t1", "t2"],
        },
      ],
      refs: [
        { id: "r1", available: new Set([DAY]), teamSeasonIds: new Set(["t1"]) },
      ],
      commitments: [],
    });
    expect(p.unfilled).toEqual([{ gameId: "g", reason: "everyone_busy" }]);
    expect(
      proposeReferees({ games: [], refs: [], commitments: [] }).unfilled,
    ).toEqual([]);
  });

  it("lets an admin waive availability and fields, but never a clash or their own team", () => {
    const game: AssignGame = {
      id: "g",
      startsAt: DAY + HOUR,
      endsAt: DAY + HOUR + LENGTH,
      fieldId: "f2",
      teamSeasonIds: ["t1", "t2"],
    };
    const ref = {
      id: "r",
      available: new Set<number>(),
      teamSeasonIds: new Set(["t9"]),
    };
    // Playing on field 1 just before: back to back on another field.
    const before = { startsAt: DAY, endsAt: DAY + LENGTH, fieldId: "f1" };
    expect(fits(ref, game, [before])).toBe(false);
    expect(allowed(ref, game, [before])).toBe(true);
    expect(allowed(ref, game, [{ ...before, endsAt: DAY + HOUR + 1 }])).toBe(
      false,
    );
    expect(allowed({ teamSeasonIds: new Set(["t2"]) }, game, [])).toBe(false);
    // Whatever fits is allowed.
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: -2, max: 2 }),
        fc.constantFrom("f1", "f2"),
        (free, own, offset, fieldId) => {
          const r: AssignRef = {
            id: "r",
            available: new Set(free ? [game.startsAt] : []),
            teamSeasonIds: new Set(own ? ["t1"] : []),
          };
          const busy = [
            {
              startsAt: game.startsAt + offset * HOUR,
              endsAt: game.startsAt + offset * HOUR + LENGTH,
              fieldId,
            },
          ];
          return !fits(r, game, busy) || allowed(r, game, busy);
        },
      ),
    );
  });
});
