import fc from "fast-check";
import type { StatGame } from "./games";

/** Shared builders and fast-check arbitraries for the stats tests. */

const DAY = 86_400_000;
const START = Date.UTC(2027, 3, 4, 23);

export const at = (day: number) => new Date(START + day * DAY);

export function played(
  teamA: string,
  scoreA: number,
  teamB: string,
  scoreB: number,
  day = 0,
  extra: Partial<StatGame> = {},
): StatGame {
  return {
    id: `g-${day}-${teamA}-${teamB}-${extra.id ?? ""}`,
    seasonId: "spring",
    kind: "regular",
    playedAt: at(day),
    teamA,
    teamB,
    result: { kind: "played", scoreA, scoreB },
    ...extra,
  };
}

export function forfeit(
  teamA: string,
  teamB: string,
  forfeitBy: string,
  day = 0,
): StatGame {
  return {
    id: `f-${day}-${teamA}-${teamB}`,
    seasonId: "spring",
    kind: "regular",
    playedAt: at(day),
    teamA,
    teamB,
    result: { kind: "forfeit", forfeitBy },
  };
}

export const TEAMS = ["A", "B", "C", "D", "E", "F"] as const;

/** A season of finished games among `TEAMS`, ids unique, days increasing. */
export const gamesArb = (teams: readonly string[] = TEAMS) =>
  fc
    .array(
      fc.record({
        pair: fc
          .tuple(fc.constantFrom(...teams), fc.constantFrom(...teams))
          .filter(([a, b]) => a !== b),
        scoreA: fc.integer({ min: 0, max: 30 }),
        scoreB: fc.integer({ min: 0, max: 30 }),
        forfeit: fc.option(fc.boolean(), { freq: 8 }),
        seasonId: fc.constantFrom("spring", "fall"),
        kind: fc.constantFrom("regular" as const, "regular", "playoff"),
      }),
      { maxLength: 40 },
    )
    .map((rows) =>
      rows.map((r, i): StatGame => ({
        id: `g${String(i).padStart(3, "0")}`,
        seasonId: r.seasonId,
        kind: r.kind,
        playedAt: at(Math.floor(i / 3)),
        teamA: r.pair[0],
        teamB: r.pair[1],
        result:
          r.forfeit === null
            ? { kind: "played", scoreA: r.scoreA, scoreB: r.scoreB }
            : {
                kind: "forfeit",
                forfeitBy: r.forfeit ? r.pair[0] : r.pair[1],
              },
      })),
    );
