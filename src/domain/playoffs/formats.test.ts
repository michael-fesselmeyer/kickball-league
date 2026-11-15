import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type BracketFormat,
  placeBracket,
  sourceCode,
} from "@/domain/scheduler/bracket";
import type { Slot } from "@/domain/scheduler/types";
import {
  advance,
  championOf,
  decidesTitle,
  isReady,
  losersColumns,
  matchesFrom,
  type MatchState,
  splitTiers,
  tierName,
} from "./playoffs";

const teams = (n: number) =>
  Array.from({ length: n }, (_, i) => `t${String(i + 1).padStart(2, "0")}`);

/** Playoff slots: `fields` fields × `times` time indexes on each date. */
function days(dates: readonly string[], fields: number, times: number): Slot[] {
  return dates.flatMap((date) =>
    Array.from({ length: fields * times }, (_, k) => {
      const timeIndex = Math.floor(k / fields);
      const fieldId = `F${(k % fields) + 1}`;
      return {
        id: `${date}/${fieldId}/${timeIndex}`,
        fieldId,
        date,
        timeIndex,
        startsAt: `${date}T${String(10 + timeIndex).padStart(2, "0")}:00:00Z`,
        endsAt: `${date}T${String(11 + timeIndex).padStart(2, "0")}:00:00Z`,
        kind: "playoff" as const,
      };
    }),
  );
}

const SUNDAYS = [
  "2027-08-08",
  "2027-08-15",
  "2027-08-22",
  "2027-08-29",
  "2027-09-05",
  "2027-09-12",
];

/** Plays every game in game-number order; `pick` says whether side A wins. */
function playOut(start: MatchState[], pick: (i: number) => boolean) {
  let matches = start;
  const played: MatchState[] = [];
  for (let i = 0; i < 200; i++) {
    const next = matches
      .filter((m) => isReady(m) && m.winner === null)
      .sort((a, b) => a.gameNo - b.gameNo)[0];
    if (!next) break;
    const winner = pick(i) ? next.teamA : next.teamB;
    matches = advance(matches, next.code, winner).matches;
    played.push({ ...next, winner });
  }
  return { matches, played };
}

const losses = (played: readonly MatchState[], team: string) =>
  played.filter(
    (m) => m.winner !== team && (m.teamA === team || m.teamB === team),
  ).length;

describe("double elimination", () => {
  it("sends four teams through a winners' side, a losers' side and a grand final", () => {
    const { matches } = placeBracket(teams(4), days(SUNDAYS, 2, 6), {
      format: "double_elimination",
    });
    expect(
      matches.map((m) => [m.gameNo, m.id, m.home, m.away].map(String)),
    ).toHaveLength(7);
    expect(matches.map((m) => m.id)).toEqual([
      "r1m1",
      "r1m2",
      "r2m1",
      "l1m1",
      "l2m1",
      "gf",
      "gf2",
    ]);
    const byId = new Map(matches.map((m) => [m.id, m]));
    expect(byId.get("l1m1")).toMatchObject({
      home: { loserOf: "r1m1" },
      away: { loserOf: "r1m2" },
    });
    expect(byId.get("l2m1")).toMatchObject({
      home: { loserOf: "r2m1" },
      away: { winnerOf: "l1m1" },
    });
    expect(byId.get("gf")).toMatchObject({
      home: { winnerOf: "r2m1" },
      away: { winnerOf: "l2m1" },
    });
    expect(byId.get("gf2")).toMatchObject({
      stage: "reset",
      home: { loserOf: "gf" },
      away: { winnerOf: "gf" },
    });
  });

  it("plays two teams up to three times", () => {
    const { matches } = placeBracket(teams(2), days(SUNDAYS, 1, 4), {
      format: "double_elimination",
    });
    expect(matches.map((m) => m.id)).toEqual(["r1m1", "gf", "gf2"]);
    expect(matches.find((m) => m.id === "gf")?.away).toEqual({
      loserOf: "r1m1",
    });
  });

  it("gives byes on the losers' side to match first-round byes", () => {
    const { matches } = placeBracket(teams(3), days(SUNDAYS, 2, 6), {
      format: "double_elimination",
    });
    // Seed 1 has a bye, so the 2 v 3 loser waits for the winners' final loser.
    expect(matches.filter((m) => m.stage === "losers")).toEqual([
      expect.objectContaining({
        id: "l2m1",
        home: { loserOf: "r2m1" },
        away: { loserOf: "r1m2" },
      }),
    ]);
    expect(losersColumns(matchesFrom({ matches, diagnostics: [] }))).toEqual([
      { round: 2, matches: [expect.objectContaining({ code: "l2m1" })] },
    ]);
  });

  it("ends at the grand final when the winners' side champion wins it", () => {
    let matches = matchesFrom(
      placeBracket(teams(4), days(SUNDAYS, 2, 6), {
        format: "double_elimination",
      }),
    );
    const win = (code: string, side: "A" | "B") => {
      const m = matches.find((x) => x.code === code)!;
      const result = advance(matches, code, side === "A" ? m.teamA : m.teamB);
      matches = result.matches;
      return result;
    };
    win("r1m1", "A");
    win("r1m2", "A");
    win("r2m1", "A");
    win("l1m1", "A");
    win("l2m1", "B");
    const gf = matches.find((m) => m.code === "gf")!;
    expect([gf.teamA, gf.teamB]).toEqual(["t01", "t04"]);
    const ended = win("gf", "A");
    expect(ended.champion).toBe("t01");
    expect(ended.skipped).toEqual({ code: "gf2", skipped: true });
    expect(matches.find((m) => m.code === "gf2")).toMatchObject({
      teamA: null,
      teamB: null,
      skipped: true,
    });
    // A corrected grand final brings the second game back.
    const corrected = win("gf", "B");
    expect(corrected.champion).toBeNull();
    expect(corrected.skipped).toEqual({ code: "gf2", skipped: false });
    expect(corrected.moves).toEqual(
      expect.arrayContaining([
        { code: "gf2", side: "A", from: null, to: "t01" },
        { code: "gf2", side: "B", from: null, to: "t04" },
      ]),
    );
    expect(win("gf2", "B").champion).toBe("t04");
  });
});

describe("third-place game", () => {
  it("puts the semifinal losers in a game before the final", () => {
    const { matches } = placeBracket(teams(4), days(SUNDAYS, 1, 6), {
      thirdPlace: true,
    });
    expect(matches.map((m) => m.id)).toEqual(["r1m1", "r1m2", "p3", "r2m1"]);
    expect(matches.find((m) => m.id === "p3")).toMatchObject({
      home: { loserOf: "r1m1" },
      away: { loserOf: "r1m2" },
    });
    let state = matchesFrom({ matches, diagnostics: [] });
    state = advance(state, "r1m1", "t01").matches;
    state = advance(state, "r1m2", "t03").matches;
    expect(state.find((m) => m.code === "p3")).toMatchObject({
      teamA: "t04",
      teamB: "t02",
    });
    // The third-place game never crowns anyone.
    state = advance(state, "p3", "t02").matches;
    expect(championOf(state)).toBeNull();
    expect(championOf(advance(state, "r2m1", "t03").matches)).toBe("t03");
  });

  it("is left out, with a note, when there are not two semifinals", () => {
    const { matches, diagnostics } = placeBracket(
      teams(3),
      days(SUNDAYS, 1, 6),
      {
        thirdPlace: true,
      },
    );
    expect(matches.some((m) => m.stage === "third_place")).toBe(false);
    expect(diagnostics).toEqual([
      "No third-place game: with 3 teams there are not two semifinals.",
    ]);
  });

  it("is never added to a double-elimination bracket", () => {
    const { matches } = placeBracket(teams(8), days(SUNDAYS, 2, 8), {
      format: "double_elimination",
      thirdPlace: true,
    });
    expect(matches.some((m) => m.stage === "third_place")).toBe(false);
  });
});

describe("title games", () => {
  it("are the single-elimination final and both grand finals", () => {
    expect(
      decidesTitle({ stage: "main", round: 3 }, 8, "single_elimination"),
    ).toBe(true);
    expect(
      decidesTitle({ stage: "main", round: 2 }, 8, "single_elimination"),
    ).toBe(false);
    expect(
      decidesTitle({ stage: "main", round: 3 }, 8, "double_elimination"),
    ).toBe(false);
    expect(
      decidesTitle({ stage: "grand_final", round: 1 }, 8, "double_elimination"),
    ).toBe(true);
    expect(
      decidesTitle({ stage: "reset", round: 1 }, 8, "double_elimination"),
    ).toBe(true);
    expect(
      decidesTitle({ stage: "third_place", round: 1 }, 8, "single_elimination"),
    ).toBe(false);
  });
});

describe("tiers", () => {
  it("splits the standings into consecutive brackets", () => {
    expect(splitTiers(teams(12), [4, 8])).toEqual([
      teams(4),
      teams(12).slice(4),
    ]);
    expect(splitTiers(teams(12), [4, 6])?.[1]).toEqual(teams(10).slice(4));
  });

  it("refuses a tier under two teams, too many tiers, or too few teams", () => {
    expect(splitTiers(teams(12), [4, 1])).toBeNull();
    expect(splitTiers(teams(12), [2, 2, 2, 2])).toBeNull();
    expect(splitTiers(teams(6), [4, 4])).toBeNull();
    expect(splitTiers(teams(6), [])).toBeNull();
  });

  it("names each tier", () => {
    expect([1, 2, 3].map(tierName)).toEqual([
      "Championship",
      "Second tier",
      "Tier 3",
    ]);
  });
});

describe("bracket properties", () => {
  const formats: BracketFormat[] = ["single_elimination", "double_elimination"];

  it("gives every team a full path: one loss out, or two in double elimination", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 32 }),
        fc.constantFrom(...formats),
        fc.boolean(),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 2, max: 8 }),
        fc.array(fc.boolean(), { minLength: 64, maxLength: 64 }),
        (n, format, thirdPlace, fields, times, coin) => {
          const slots = days(SUNDAYS, fields, times);
          const placed = placeBracket(teams(n), slots, { format, thirdPlace });
          const { matches } = placed;
          const third = format === "single_elimination" && thirdPlace && n >= 4;
          expect(matches).toHaveLength(
            format === "double_elimination"
              ? 2 * n - 1
              : n - 1 + (third ? 1 : 0),
          );
          // Every team is seeded exactly once.
          const seeded = matches.flatMap((m) =>
            [m.home, m.away].flatMap((s) => ("seed" in s ? [s.teamId] : [])),
          );
          expect([...seeded].sort()).toEqual(teams(n));
          // Game numbers run 1..count, and every source is an earlier game.
          expect(matches.map((m) => m.gameNo)).toEqual(
            matches.map((_, i) => i + 1),
          );
          const gameNo = new Map(matches.map((m) => [m.id, m.gameNo]));
          for (const m of matches)
            for (const side of [m.home, m.away]) {
              const code = sourceCode(side);
              if (code) expect(gameNo.get(code)).toBeLessThan(m.gameNo);
            }

          const { matches: end, played } = playOut(
            matchesFrom(placed),
            (i) => coin[i % coin.length] as boolean,
          );
          const champion = championOf(end);
          expect(champion).not.toBeNull();
          // Nothing is left waiting: every game is played or not needed.
          for (const m of end)
            expect(m.winner !== null || m.skipped).toBe(true);
          const counted = (team: string) =>
            losses(
              played.filter((m) => m.stage !== "third_place"),
              team,
            );
          for (const team of teams(n)) {
            if (format === "single_elimination")
              expect(counted(team)).toBe(team === champion ? 0 : 1);
            else if (team === champion) expect(counted(team)).toBeLessThan(2);
            else expect(counted(team)).toBe(2);
            // Once out, a team plays no more (bar the third-place game).
            const games = played.filter(
              (m) =>
                m.stage !== "third_place" &&
                (m.teamA === team || m.teamB === team),
            );
            const limit = format === "single_elimination" ? 1 : 2;
            let lost = 0;
            for (const g of games) {
              expect(lost).toBeLessThan(limit);
              if (g.winner !== team) lost++;
            }
          }

          // The "if necessary" game is played exactly when the losers'
          // side champion wins the grand final.
          const gf = end.find((m) => m.stage === "grand_final");
          const reset = end.find((m) => m.stage === "reset");
          if (gf && reset) {
            const needed = gf.winner === gf.teamB;
            expect(reset.skipped).toBe(!needed);
            expect(played.some((m) => m.stage === "reset")).toBe(needed);
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it("never has a team in two places at once, and plays every game after its feeders", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 24 }),
        fc.constantFrom(...formats),
        fc.boolean(),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 2, max: 8 }),
        fc.array(fc.boolean(), { minLength: 48, maxLength: 48 }),
        (n, format, thirdPlace, fields, times, coin) => {
          const slots = days(SUNDAYS, fields, times);
          const placed = placeBracket(teams(n), slots, { format, thirdPlace });
          const slotOf = new Map(slots.map((s) => [s.id, s]));
          const at = (id: string | null) => {
            const s = id ? slotOf.get(id) : undefined;
            return s
              ? `${s.date}#${String(s.timeIndex).padStart(2, "0")}`
              : null;
          };
          const ids = placed.matches.flatMap((m) => m.slotId ?? []);
          expect(new Set(ids).size).toBe(ids.length);
          const byId = new Map(placed.matches.map((m) => [m.id, m]));
          for (const m of placed.matches) {
            const when = at(m.slotId);
            if (!when) continue;
            for (const side of [m.home, m.away]) {
              const code = sourceCode(side);
              const feeder = code ? at(byId.get(code)?.slotId ?? null) : null;
              if (feeder) expect(feeder < when).toBe(true);
            }
          }
          // Whatever the results, a team's games are at distinct, rising times.
          const slotByCode = new Map(
            placed.matches.map((m) => [m.id, m.slotId]),
          );
          const { played } = playOut(
            matchesFrom(placed),
            (i) => coin[i % coin.length] as boolean,
          );
          for (const team of teams(n)) {
            const times = played
              .filter((m) => m.teamA === team || m.teamB === team)
              .map((m) => at(slotByCode.get(m.code) ?? null))
              .filter((t): t is string => t !== null);
            for (let i = 1; i < times.length; i++)
              expect((times[i - 1] as string) < (times[i] as string)).toBe(
                true,
              );
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it("places the if-necessary final after the grand final, both within the permits", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 16 }),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 2, max: 8 }),
        (n, fields, times) => {
          const slots = days(SUNDAYS, fields, times);
          const { matches, diagnostics } = placeBracket(teams(n), slots, {
            format: "double_elimination",
          });
          const known = new Set(slots.map((s) => s.id));
          for (const m of matches)
            if (m.slotId) expect(known.has(m.slotId)).toBe(true);
          const gf = matches.find((m) => m.stage === "grand_final")!;
          const reset = matches.find((m) => m.stage === "reset")!;
          expect(reset.gameNo).toBe(matches.length);
          expect(gf.gameNo).toBe(matches.length - 1);
          if (gf.slotId && reset.slotId) {
            const s = (id: string) => slots.find((x) => x.id === id)!;
            const [a, b] = [s(gf.slotId), s(reset.slotId)];
            expect(
              a.date < b.date ||
                (a.date === b.date && a.timeIndex < b.timeIndex),
            ).toBe(true);
          }
          // Every game without a slot is reported.
          const unplaced = matches.filter((m) => m.slotId === null).length;
          expect(
            diagnostics.filter((d) => d.startsWith("No free slot")).length,
          ).toBe(unplaced);
        },
      ),
      { numRuns: 300 },
    );
  });
});
