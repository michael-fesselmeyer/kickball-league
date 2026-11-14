import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type BoardRow,
  checkPick,
  comingGameDay,
  dayLabel,
  type GameStatus,
  gameDayOf,
  gameResult,
  isLocked,
  ordinal,
  type PickemGame,
  pickOutcome,
  placeLabel,
  rankBoard,
  readDay,
} from "./pickem";

const A = "team-a";
const B = "team-b";
const SLOT = "slot-1";
const starts = new Date("2026-10-13T00:00:00Z"); // 8 pm Oct 12 in New York

const game = (over: Partial<PickemGame> = {}): PickemGame => ({
  status: "scheduled",
  teamAId: A,
  teamBId: B,
  slotId: SLOT,
  startsAt: starts,
  slotCancelled: false,
  scoreA: null,
  scoreB: null,
  ...over,
});
const final = (scoreA: number, scoreB: number) =>
  game({ status: "final", scoreA, scoreB });

const STATUSES: GameStatus[] = [
  "scheduled",
  "in_progress",
  "final",
  "postponed",
  "cancelled",
  "forfeit",
];
const anyGame = fc.record({
  status: fc.constantFrom(...STATUSES),
  teamAId: fc.constant(A),
  teamBId: fc.constant(B),
  slotId: fc.constantFrom(SLOT, "slot-2", null),
  startsAt: fc.option(
    fc.date({
      min: new Date("2026-01-01T00:00:00Z"),
      max: new Date("2027-12-31T00:00:00Z"),
      noInvalidDate: true,
    }),
  ),
  slotCancelled: fc.boolean(),
  scoreA: fc.option(fc.integer({ min: 0, max: 30 })),
  scoreB: fc.option(fc.integer({ min: 0, max: 30 })),
});
const anyNow = fc.date({
  min: new Date("2025-01-01T00:00:00Z"),
  max: new Date("2028-12-31T00:00:00Z"),
  noInvalidDate: true,
});
const anyPick = fc.record({
  teamSeasonId: fc.constantFrom(A, B),
  slotId: fc.constantFrom(SLOT, "slot-2", null),
});

describe("locking", () => {
  it("locks each game at its own start time, to the millisecond", () => {
    const g = game();
    expect(isLocked(g, new Date(starts.getTime() - 1))).toBe(false);
    expect(isLocked(g, starts)).toBe(true);
    expect(isLocked(g, new Date(starts.getTime() + 60_000))).toBe(true);
  });

  it("locks a game that is not scheduled, has no slot or was rained out", () => {
    const early = new Date(starts.getTime() - 86_400_000);
    for (const status of STATUSES.filter((s) => s !== "scheduled"))
      expect(isLocked(game({ status }), early)).toBe(true);
    expect(isLocked(game({ startsAt: null }), early)).toBe(true);
    expect(isLocked(game({ slotCancelled: true }), early)).toBe(true);
  });

  it("is open exactly while a scheduled game in an open slot has not started", () => {
    fc.assert(
      fc.property(anyGame, anyNow, (g, now) => {
        const open =
          g.status === "scheduled" &&
          !g.slotCancelled &&
          g.startsAt !== null &&
          now.getTime() < g.startsAt.getTime();
        expect(isLocked(g, now)).toBe(!open);
      }),
    );
  });

  it("never reopens once locked as time goes on", () => {
    fc.assert(
      fc.property(
        anyGame,
        anyNow,
        fc.nat({ max: 10 ** 10 }),
        (g, now, later) => {
          if (isLocked(g, now))
            expect(isLocked(g, new Date(now.getTime() + later))).toBe(true);
        },
      ),
    );
  });
});

describe("scoring", () => {
  it("scores a confirmed win right or wrong", () => {
    expect(gameResult(final(5, 3))).toEqual({ kind: "won", winner: A });
    expect(gameResult(final(2, 9))).toEqual({ kind: "won", winner: B });
    expect(pickOutcome({ teamSeasonId: A, slotId: SLOT }, final(5, 3))).toBe(
      "correct",
    );
    expect(pickOutcome({ teamSeasonId: B, slotId: SLOT }, final(5, 3))).toBe(
      "wrong",
    );
  });

  it("waits for a confirmed result", () => {
    expect(gameResult(game())).toEqual({ kind: "pending" });
    // Live scores are not a result yet.
    expect(
      gameResult(game({ status: "in_progress", scoreA: 4, scoreB: 1 })),
    ).toEqual({ kind: "pending" });
    expect(pickOutcome({ teamSeasonId: A, slotId: SLOT }, game())).toBe(
      "pending",
    );
  });

  it("voids forfeits, ties, rain-outs, postponements and cancellations", () => {
    expect(gameResult(game({ status: "forfeit" }))).toEqual({
      kind: "void",
      reason: "forfeit",
    });
    expect(gameResult(final(4, 4))).toEqual({ kind: "void", reason: "tie" });
    expect(gameResult(game({ slotCancelled: true }))).toEqual({
      kind: "void",
      reason: "rained_out",
    });
    expect(gameResult(game({ status: "postponed" }))).toEqual({
      kind: "void",
      reason: "postponed",
    });
    expect(gameResult(game({ status: "cancelled" }))).toEqual({
      kind: "void",
      reason: "cancelled",
    });
  });

  it("voids a pick made for a slot the game has left, even if it wins", () => {
    expect(
      pickOutcome({ teamSeasonId: A, slotId: "slot-2" }, final(5, 3)),
    ).toBe("void");
    expect(pickOutcome({ teamSeasonId: A, slotId: null }, final(5, 3))).toBe(
      "void",
    );
  });

  it("gives exactly one of the two picks the win when a game is won", () => {
    fc.assert(
      fc.property(anyGame, (g) => {
        const a = pickOutcome({ teamSeasonId: A, slotId: g.slotId }, g);
        const b = pickOutcome({ teamSeasonId: B, slotId: g.slotId }, g);
        if (g.slotId === null) {
          expect([a, b]).toEqual(["void", "void"]);
          return;
        }
        const result = gameResult(g);
        if (result.kind === "won")
          expect([a, b].sort()).toEqual(["correct", "wrong"]);
        else expect(a).toBe(b);
      }),
    );
  });

  it("only ever scores a final game with a winner", () => {
    fc.assert(
      fc.property(anyPick, anyGame, (pick, g) => {
        const outcome = pickOutcome(pick, g);
        if (outcome === "correct" || outcome === "wrong") {
          expect(g.status).toBe("final");
          expect(g.slotCancelled).toBe(false);
          expect(pick.slotId).toBe(g.slotId);
          expect(g.scoreA).not.toBe(g.scoreB);
        }
        if (g.status === "forfeit") expect(outcome).toBe("void");
      }),
    );
  });
});

describe("checking a pick", () => {
  const before = new Date(starts.getTime() - 3_600_000);
  const context = {
    now: before,
    myTeams: [] as string[],
    ownGamesAllowed: true,
  };

  it("accepts either team of an open game", () => {
    expect(checkPick(game(), A, context).ok).toBe(true);
    expect(checkPick(game(), B, context).ok).toBe(true);
  });

  it("refuses a team not in the game and a game that has locked", () => {
    expect(checkPick(game(), "team-c", context)).toEqual({
      ok: false,
      error: "not_in_game",
    });
    expect(checkPick(game(), A, { ...context, now: starts })).toEqual({
      ok: false,
      error: "locked",
    });
  });

  it("follows the league's setting for the player's own team's games", () => {
    const mine = { ...context, myTeams: [B] };
    expect(checkPick(game(), A, mine).ok).toBe(true);
    expect(checkPick(game(), A, { ...mine, ownGamesAllowed: false })).toEqual({
      ok: false,
      error: "own_team",
    });
    expect(
      checkPick(game({ teamAId: "x", teamBId: "y" }), "x", {
        ...mine,
        ownGamesAllowed: false,
      }).ok,
    ).toBe(true);
  });
});

describe("game days", () => {
  const tz = "America/New_York";

  it("reads the date on the league's clock, not UTC", () => {
    // 8 pm Monday in New York is already Tuesday in UTC.
    expect(gameDayOf(starts, tz)).toBe("2026-10-12");
    expect(gameDayOf(starts, "UTC")).toBe("2026-10-13");
    // Across the autumn clock change, 11:30 pm stays on its own day.
    expect(gameDayOf(new Date("2026-11-02T04:30:00Z"), tz)).toBe("2026-11-01");
  });

  it("is the day of the earliest game still open, and stays while its later games are", () => {
    const early = game({ startsAt: new Date("2026-10-13T00:00:00Z") });
    const late = game({ startsAt: new Date("2026-10-13T01:00:00Z") });
    const nextWeek = game({ startsAt: new Date("2026-10-20T00:00:00Z") });
    const games = [nextWeek, late, early];
    expect(comingGameDay(games, new Date("2026-10-10T00:00:00Z"), tz)).toBe(
      "2026-10-12",
    );
    // The first game has started; the second is still open.
    expect(comingGameDay(games, new Date("2026-10-13T00:30:00Z"), tz)).toBe(
      "2026-10-12",
    );
    expect(comingGameDay(games, new Date("2026-10-13T01:00:00Z"), tz)).toBe(
      "2026-10-19",
    );
    expect(comingGameDay(games, new Date("2026-10-21T00:00:00Z"), tz)).toBe(
      null,
    );
  });

  it("labels a day and reads only real dates from the URL", () => {
    expect(dayLabel("2026-10-06")).toBe("Tue, Oct 6");
    expect(readDay("2026-10-06")).toBe("2026-10-06");
    for (const bad of ["2026-02-30", "2026-1-6", "yesterday", "", null, 7])
      expect(readDay(bad)).toBeNull();
  });

  it("skips a rained-out game", () => {
    const rained = game({ slotCancelled: true });
    expect(comingGameDay([rained], new Date("2026-10-10T00:00:00Z"), tz)).toBe(
      null,
    );
  });
});

describe("leaderboards", () => {
  const row = (name: string, correct: number, scored = correct): BoardRow => ({
    userId: name,
    name,
    correct,
    scored,
  });

  it("ranks by correct picks and ties share a place", () => {
    const ranked = rankBoard([
      row("Cy", 3, 5),
      row("Ana", 5, 6),
      row("Bo", 3, 4),
      row("Di", 1),
    ]);
    expect(ranked.map((r) => [r.name, r.place])).toEqual([
      ["Ana", 1],
      ["Bo", 2],
      ["Cy", 2],
      ["Di", 4],
    ]);
    expect(ranked.map((r) => placeLabel(r, ranked))).toEqual([
      "1st",
      "T-2nd",
      "T-2nd",
      "4th",
    ]);
  });

  it("names places", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "101st",
      "111th",
    ]);
  });

  const rows = fc.uniqueArray(
    fc.record({
      userId: fc.uuid(),
      name: fc.string({ maxLength: 8 }),
      correct: fc.nat({ max: 20 }),
      scored: fc.nat({ max: 20 }),
    }),
    { selector: (r) => r.userId, maxLength: 40 },
  );

  it("gives each player one more than the number who got more right", () => {
    fc.assert(
      fc.property(rows, (input) => {
        const ranked = rankBoard(input);
        expect(ranked).toHaveLength(input.length);
        for (const r of ranked)
          expect(r.place).toBe(
            1 + input.filter((o) => o.correct > r.correct).length,
          );
      }),
    );
  });

  it("shares a place exactly when correct counts are equal, in order", () => {
    fc.assert(
      fc.property(rows, (input) => {
        const ranked = rankBoard(input);
        ranked.forEach((r, i) => {
          const prev = ranked[i - 1];
          if (!prev) return expect(r.place).toBe(1);
          expect(prev.correct).toBeGreaterThanOrEqual(r.correct);
          expect(prev.place === r.place).toBe(prev.correct === r.correct);
        });
      }),
    );
  });

  it("does not depend on the order rows arrive in", () => {
    fc.assert(
      fc.property(
        rows.chain((input) =>
          fc.tuple(
            fc.constant(input),
            fc.shuffledSubarray(input, {
              minLength: input.length,
              maxLength: input.length,
            }),
          ),
        ),
        ([input, shuffled]) => {
          expect(rankBoard(shuffled)).toEqual(rankBoard(input));
        },
      ),
    );
  });
});
