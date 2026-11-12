import { describe, expect, it } from "vitest";
import { placeBracket } from "@/domain/scheduler/bracket";
import type { Slot } from "@/domain/scheduler/types";
import { standings } from "@/domain/standings/standings";
import {
  advance,
  boardColumns,
  bracketSize,
  byeSeeds,
  championOf,
  defaultPlayoffTeams,
  gameWinner,
  isReady,
  matchesFrom,
  type MatchState,
  nextMatch,
  pickSeeds,
  roundCount,
  roundName,
  sourceLabel,
} from "./playoffs";

const teams = (n: number) =>
  Array.from({ length: n }, (_, i) => `t${String(i + 1).padStart(2, "0")}`);

/** One playoff Sunday: two fields, enough times for any test here. */
function slots(times = 8): Slot[] {
  return Array.from({ length: times }).flatMap((_, timeIndex) =>
    ["f1", "f2"].map((fieldId) => ({
      id: `${fieldId}-${timeIndex}`,
      fieldId,
      date: "2027-05-23",
      timeIndex,
      startsAt: `2027-05-23T${String(14 + timeIndex).padStart(2, "0")}:00:00Z`,
      endsAt: `2027-05-23T${String(15 + timeIndex).padStart(2, "0")}:00:00Z`,
      kind: "playoff" as const,
    })),
  );
}

const bracketFor = (n: number) => matchesFrom(placeBracket(teams(n), slots()));

/** Plays a match: the given side wins. */
function win(matches: MatchState[], code: string, side: "A" | "B") {
  const m = matches.find((x) => x.code === code)!;
  return advance(matches, code, side === "A" ? m.teamA : m.teamB);
}

describe("seeding", () => {
  it("takes the top teams in standings order, tiebreakers included", () => {
    // t1 and t2 both go 1-1; t2 won head-to-head, so t1 sits below it on that tiebreaker.
    const rows = standings(
      ["t1", "t2", "t3", "t4"],
      [
        { kind: "played", teamA: "t1", teamB: "t2", scoreA: 1, scoreB: 2 },
        { kind: "played", teamA: "t1", teamB: "t3", scoreA: 5, scoreB: 0 },
        { kind: "played", teamA: "t2", teamB: "t4", scoreA: 0, scoreB: 9 },
        { kind: "played", teamA: "t3", teamB: "t4", scoreA: 0, scoreB: 3 },
      ],
      { seed: "season" },
    );
    const seeds = pickSeeds(rows, new Set(["t1", "t2", "t3", "t4"]), 3);
    expect(seeds).toEqual(["t4", "t2", "t1"]);
    expect(rows.find((r) => r.teamId === "t1")?.separatedBy).toBe(
      "head_to_head",
    );
  });

  it("skips teams that left the season without losing a place", () => {
    const rows = ["a", "b", "c", "d"].map((teamId, i) => ({
      teamId,
      rank: i + 1,
    }));
    expect(pickSeeds(rows, new Set(["a", "c", "d"]), 3)).toEqual([
      "a",
      "c",
      "d",
    ]);
    expect(pickSeeds(rows, new Set(["a"]), 3)).toEqual(["a"]);
    expect(pickSeeds(rows, new Set(["a"]), -1)).toEqual([]);
  });

  it("qualifies the top 8, or every team when there are fewer", () => {
    expect(defaultPlayoffTeams(12)).toBe(8);
    expect(defaultPlayoffTeams(6)).toBe(6);
  });
});

describe("bracket shape", () => {
  it.each([
    [2, 2, 1, []],
    [5, 8, 3, [1, 2, 3]],
    [6, 8, 3, [1, 2]],
    [8, 8, 3, []],
    [12, 16, 4, [1, 2, 3, 4]],
  ])("%i teams: size %i, %i rounds, byes for %j", (n, size, rounds, byes) => {
    expect(bracketSize(n)).toBe(size);
    expect(roundCount(n)).toBe(rounds);
    expect(byeSeeds(n)).toEqual(byes);
    // Every match but the byes is played: n - 1 games crown a champion.
    expect(bracketFor(n)).toHaveLength(n - 1);
  });

  it("has no rounds for fewer than two teams", () => {
    expect(roundCount(1)).toBe(0);
    expect(byeSeeds(1)).toEqual([]);
  });

  it("names the last rounds", () => {
    expect([1, 2, 3, 4].map((r) => roundName(r, 4))).toEqual([
      "Round 1",
      "Quarterfinals",
      "Semifinals",
      "Final",
    ]);
  });

  it("puts bye teams straight into round 2", () => {
    const matches = bracketFor(6);
    const round2 = matches.filter((m) => m.round === 2);
    // Seeds 1 and 2 wait for the winners of 4 v 5 and 3 v 6.
    expect(round2.map((m) => [m.teamA, m.teamB])).toEqual([
      ["t01", null],
      ["t02", null],
    ]);
    expect(round2.map((m) => m.sourceB)).toEqual([
      { winnerOf: "r1m2" },
      { winnerOf: "r1m4" },
    ]);
    // A bye leaves a gap in round 1's positions.
    expect(matches.filter((m) => m.round === 1).map((m) => m.position)).toEqual(
      [2, 4],
    );
  });

  it("can be ready in round 2 at once when both sides had byes", () => {
    const matches = bracketFor(5);
    const ready = matches.filter(isReady).map((m) => m.code);
    // 4 v 5 plays first; 2 v 3 meet in round 2 without waiting.
    expect(ready).toEqual(["r1m2", "r2m2"]);
  });
});

describe("advancing", () => {
  it("moves each winner on until there is a champion", () => {
    let matches = bracketFor(8);
    expect(matches.filter(isReady)).toHaveLength(4);
    for (const code of ["r1m1", "r1m2", "r1m3", "r1m4"])
      matches = win(matches, code, "A").matches;
    const semis = matches.filter((m) => m.round === 2);
    expect(semis.map((m) => [m.teamA, m.teamB])).toEqual([
      ["t01", "t04"],
      ["t02", "t03"],
    ]);
    matches = win(matches, "r2m1", "B").matches;
    matches = win(matches, "r2m2", "A").matches;
    const final = win(matches, "r3m1", "A");
    expect(final.champion).toBe("t04");
    expect(final.moved).toBeNull();
    expect(championOf(final.matches)).toBe("t04");
  });

  it("reports which side of the next match it filled", () => {
    const matches = bracketFor(6);
    const result = win(matches, "r1m2", "B");
    expect(result.moved).toEqual({
      code: "r2m1",
      side: "B",
      from: null,
      to: "t05",
    });
    expect(nextMatch(matches, "r2m1")).toEqual({ code: "r3m1", side: "A" });
  });

  it("replaces the team it moved on when a score is corrected", () => {
    let matches = win(bracketFor(4), "r1m1", "A").matches;
    const corrected = win(matches, "r1m1", "B");
    expect(corrected.moved).toEqual({
      code: "r2m1",
      side: "A",
      from: "t01",
      to: "t04",
    });
    matches = corrected.matches;
    expect(matches.find((m) => m.code === "r2m1")?.teamA).toBe("t04");
    // The same result again changes nothing.
    expect(win(matches, "r1m1", "B").moved).toBeNull();
    // A result taken back clears the team it moved on.
    expect(advance(matches, "r1m1", null).moved?.to).toBeNull();
  });

  it("refuses a winner who is not in the match", () => {
    expect(() => advance(bracketFor(4), "r1m1", "t02")).toThrow(
      /does not play/,
    );
    expect(() => advance(bracketFor(4), "r9m9", "t01")).toThrow(/Unknown/);
  });

  it("has no champion before the final is played", () => {
    expect(championOf(bracketFor(4))).toBeNull();
    expect(championOf([])).toBeNull();
  });
});

describe("gameWinner", () => {
  const base = { teamA: "a", teamB: "b", forfeitBy: null };
  it("is the higher score once final", () => {
    expect(gameWinner({ ...base, status: "final", scoreA: 3, scoreB: 5 })).toBe(
      "b",
    );
    expect(gameWinner({ ...base, status: "final", scoreA: 6, scoreB: 5 })).toBe(
      "a",
    );
  });
  it("is the other team after a forfeit", () => {
    expect(
      gameWinner({
        ...base,
        status: "forfeit",
        forfeitBy: "a",
        scoreA: null,
        scoreB: null,
      }),
    ).toBe("b");
    expect(
      gameWinner({
        ...base,
        status: "forfeit",
        forfeitBy: "b",
        scoreA: null,
        scoreB: null,
      }),
    ).toBe("a");
  });
  it("is nobody before the game is final, or after a tie", () => {
    expect(
      gameWinner({ ...base, status: "scheduled", scoreA: null, scoreB: null }),
    ).toBeNull();
    expect(
      gameWinner({ ...base, status: "final", scoreA: 4, scoreB: 4 }),
    ).toBeNull();
  });
});

describe("the bracket board", () => {
  it("lays out every round with first-round byes in place", () => {
    const columns = boardColumns(6, bracketFor(6));
    expect(columns.map((c) => c.cells.length)).toEqual([4, 2, 1]);
    expect(
      columns[0]!.cells.map((c) =>
        c.kind === "bye" ? `bye ${c.seed}` : c.match.code,
      ),
    ).toEqual(["bye 1", "r1m2", "bye 2", "r1m4"]);
    expect(columns[2]!.cells[0]).toMatchObject({ kind: "match" });
  });

  it("names undecided sides by the game they wait on", () => {
    expect(sourceLabel({ seed: 3 }, 3)).toBe("Seed 3");
    expect(sourceLabel({ winnerOf: "r1m2" }, 3)).toBe(
      "Winner of quarterfinal 2",
    );
    expect(sourceLabel({ winnerOf: "r2m1" }, 3)).toBe("Winner of semifinal 1");
    expect(sourceLabel({ winnerOf: "r1m7" }, 4)).toBe(
      "Winner of round 1 game 7",
    );
  });
});
