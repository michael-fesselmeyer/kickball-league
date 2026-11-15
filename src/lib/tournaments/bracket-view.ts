import type { BracketView } from "@/db/queries/playoffs";
import type { BracketId, TeamSeasonId } from "@/domain/ids";
import { roundCount } from "@/domain/playoffs/playoffs";
import type { TournamentBracket } from "@/domain/tournaments/bracket";

/**
 * A tournament's bracket in the shape the playoff bracket components draw,
 * so a guest tournament looks and reads like a season's playoffs. Guest
 * teams have no team page, so no side has a slug.
 */
export function bracketViewOf(
  b: TournamentBracket,
  timeZone: string,
): BracketView {
  const seedOf = new Map(b.seeds.map((s) => [s.teamId, s]));
  const side = (id: string | null) => {
    if (!id) return null;
    const s = seedOf.get(id);
    return {
      id: id as TeamSeasonId,
      name: s?.name ?? "Team",
      slug: null,
      colorHex: null,
      seed: s?.seed ?? null,
    };
  };
  return {
    id: "tournament" as BracketId,
    division: null,
    status: b.champion ? "complete" : "published",
    size: b.seeds.length,
    rounds: roundCount(b.seeds.length),
    diagnostics: [],
    timeZone,
    champion: side(b.champion),
    seeds: b.seeds.map((s) => ({ seed: s.seed, team: side(s.teamId) })),
    matches: b.matches.map((m) => ({
      code: m.code,
      round: m.round,
      position: m.position,
      sourceA: m.sourceA,
      sourceB: m.sourceB,
      teamA: side(m.teamA),
      teamB: side(m.teamB),
      winnerId: m.winner as TeamSeasonId | null,
      gameId: null,
      status: m.winner ? ("final" as const) : null,
      scoreA: m.scoreA,
      scoreB: m.scoreB,
      startsAt: m.startsAt ? new Date(m.startsAt) : null,
      fieldName: m.place,
    })),
  };
}
