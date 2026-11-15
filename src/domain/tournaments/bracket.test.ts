import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  hasResults,
  makeBracket,
  recordScore,
  setSchedule,
  type TournamentBracket,
} from "./bracket";

const teams = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i + 1}`,
    name: `Team ${i + 1}`,
  }));

const build = (n: number): TournamentBracket => {
  const r = makeBracket(teams(n));
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

/** Plays every ready game, the lower seed number winning, until done. */
function playOut(b: TournamentBracket): TournamentBracket {
  let bracket = b;
  for (;;) {
    const next = bracket.matches.find(
      (m) => m.teamA && m.teamB && m.winner === null,
    );
    if (!next) return bracket;
    const aWins = Number(next.teamA?.slice(1)) < Number(next.teamB?.slice(1));
    const r = recordScore(bracket, next.code, aWins ? 5 : 2, aWins ? 2 : 5);
    if (!r.ok) throw new Error(r.error);
    bracket = r.value;
  }
}

const must = <T>(r: { ok: true; value: T } | { ok: false; error: string }) => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe("makeBracket", () => {
  it("needs two to thirty-two teams", () => {
    expect(makeBracket(teams(1))).toEqual({ ok: false, error: "too_few" });
    expect(makeBracket(teams(33))).toEqual({ ok: false, error: "too_many" });
  });
  it("gives the top seeds byes when the field is odd", () => {
    const b = build(5);
    expect(b.matches.filter((m) => m.round === 1)).toHaveLength(1);
    expect(b.matches).toHaveLength(4);
  });
  it("seeds a single game for two teams", () => {
    const b = build(2);
    expect(b.matches).toHaveLength(1);
    expect(b.matches[0]).toMatchObject({ teamA: "t1", teamB: "t2" });
  });
});

describe("recordScore", () => {
  it("moves the winner on and crowns a champion", () => {
    const done = playOut(build(4));
    expect(done.champion).toBe("t1");
    expect(hasResults(done)).toBe(true);
  });
  it("refuses ties, bad scores, unknown and unready games", () => {
    const b = build(4);
    expect(recordScore(b, "r1m1", 3, 3)).toEqual({ ok: false, error: "tie" });
    expect(recordScore(b, "r1m1", -1, 3)).toEqual({
      ok: false,
      error: "bad_score",
    });
    expect(recordScore(b, "r1m1", 1.5, 3)).toEqual({
      ok: false,
      error: "bad_score",
    });
    expect(recordScore(b, "r9m9", 4, 3)).toEqual({
      ok: false,
      error: "no_such_match",
    });
    expect(recordScore(b, "r2m1", 4, 3)).toEqual({
      ok: false,
      error: "not_ready",
    });
  });
  it("corrects a score before the next game is played", () => {
    const first = must(recordScore(build(4), "r1m1", 5, 2));
    const fixed = must(recordScore(first, "r1m1", 1, 6));
    expect(fixed.matches.find((m) => m.code === "r2m1")?.teamA).toBe("t4");
  });
  it("won't flip a winner who already played the next round", () => {
    let b = build(4);
    b = must(recordScore(b, "r1m1", 5, 2));
    b = must(recordScore(b, "r1m2", 5, 2));
    b = must(recordScore(b, "r2m1", 4, 1));
    expect(recordScore(b, "r1m1", 1, 6)).toEqual({
      ok: false,
      error: "later_played",
    });
    // The same winner with a new score is fine.
    expect(recordScore(b, "r1m1", 9, 0).ok).toBe(true);
  });
  it("keeps a game's place and time through a result", () => {
    const at = new Date("2027-06-05T15:00:00Z");
    const placed = must(setSchedule(build(4), "r1m1", " Field 2 ", at));
    const r = must(recordScore(placed, "r1m1", 5, 2));
    expect(r.matches[0]?.place).toBe("Field 2");
    expect(r.matches[0]?.startsAt).toBe(at.toISOString());
    const cleared = must(setSchedule(r, "r1m1", "", null));
    expect(cleared.matches[0]).toMatchObject({ place: null, startsAt: null });
    expect(setSchedule(r, "r9m9", "x", null)).toEqual({
      ok: false,
      error: "no_such_match",
    });
  });
});

describe("any field size", () => {
  it("crowns one champion; every other team loses once; no team twice a round", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 32 }), (n) => {
        const done = playOut(build(n));
        expect(done.champion).toBe("t1");
        const losses = new Map<string, number>();
        for (const m of done.matches) {
          const loser = m.winner === m.teamA ? m.teamB : m.teamA;
          if (loser) losses.set(loser, (losses.get(loser) ?? 0) + 1);
        }
        expect(losses.size).toBe(n - 1);
        expect([...losses.values()].every((c) => c === 1)).toBe(true);
        const rounds = Math.max(...done.matches.map((m) => m.round));
        for (let round = 1; round <= rounds; round++) {
          const seen = done.matches
            .filter((m) => m.round === round)
            .flatMap((m) => [m.teamA, m.teamB])
            .filter(Boolean);
          expect(new Set(seen).size).toBe(seen.length);
        }
      }),
      { numRuns: 40 },
    );
  });
});
