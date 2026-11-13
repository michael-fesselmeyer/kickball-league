import { err, ok, type Result } from "@/domain/result";
import { type StatGame, sideOf, winnerOf } from "@/domain/stats/games";
import { powerRankings } from "@/domain/stats/power";

/**
 * Suggestions for the team of the week: the game day's best wins. Beating a
 * team ranked above them counts most, then the size of the win. The admin
 * makes the call; this only puts the likely picks first.
 *
 * Teams are keys, as in the score stats. Pure: no clock, no database.
 */

export type Suggestion = {
  team: string;
  opponent: string;
  gameId: string;
  runsFor: number;
  runsAgainst: number;
  /** The opponent's power ranking going into the day, if it had one. */
  opponentRank: number | null;
  upset: boolean;
  score: number;
};

const UPSET_WEIGHT = 2;

export function suggestTeamsOfWeek(
  teams: readonly string[],
  season: readonly StatGame[],
  day: string,
  dayOf: (instant: Date) => string,
  limit = 3,
): Suggestion[] {
  const regular = season.filter((g) => g.kind === "regular");
  const before = powerRankings(
    teams,
    regular.filter((g) => dayOf(g.playedAt) < day),
  );
  const rankOf = new Map(before.map((r) => [r.team, r.rank]));
  const suggestions = regular
    .filter((g) => dayOf(g.playedAt) === day && g.result.kind === "played")
    .flatMap((g): Suggestion[] => {
      const winner = winnerOf(g);
      if (winner === null) return [];
      const side = sideOf(g, winner);
      if (side.runsFor === null || side.runsAgainst === null) return [];
      const mine = rankOf.get(winner);
      const theirs = rankOf.get(side.opponent);
      const climb =
        mine !== undefined && theirs !== undefined && theirs < mine
          ? mine - theirs
          : 0;
      return [
        {
          team: winner,
          opponent: side.opponent,
          gameId: g.id,
          runsFor: side.runsFor,
          runsAgainst: side.runsAgainst,
          opponentRank: theirs ?? null,
          upset: climb > 0,
          score: side.runsFor - side.runsAgainst + UPSET_WEIGHT * climb,
        },
      ];
    });
  return suggestions
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.runsFor - a.runsFor ||
        a.team.localeCompare(b.team),
    )
    .slice(0, limit);
}

/** A ready-made reason the admin can keep or rewrite. */
export function suggestionReason(s: Suggestion, opponentName: string): string {
  const score = `${s.runsFor}–${s.runsAgainst}`;
  if (s.upset && s.opponentRank !== null)
    return `Took down No. ${s.opponentRank} ${opponentName}, ${score}.`;
  if (s.runsFor - s.runsAgainst <= 1)
    return `Edged ${opponentName} ${score} in the day's tightest finish.`;
  return `Beat ${opponentName} ${score}.`;
}

export type TeamOfWeekForm = {
  weekOf: string;
  teamSeasonId: string;
  sponsorId: string | null;
  tabCents: number | null;
  reason: string;
};

export type TeamOfWeekFormError =
  | "bad_day"
  | "no_team"
  | "reason_missing"
  | "reason_too_long"
  | "bad_tab"
  | "tab_needs_sponsor";

/** Reads the team of the week form. The tab is in whole or decimal dollars. */
export function parseTeamOfWeekForm(fields: {
  day: string;
  team: string;
  sponsor: string;
  tab: string;
  reason: string;
}): Result<TeamOfWeekForm, TeamOfWeekFormError> {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(fields.day) ||
    Number.isNaN(Date.parse(fields.day))
  )
    return err("bad_day");
  if (!fields.team) return err("no_team");
  const reason = fields.reason.trim();
  if (!reason) return err("reason_missing");
  if (reason.length > 280) return err("reason_too_long");
  const tab = fields.tab.trim().replace(/^\$/, "");
  let tabCents: number | null = null;
  if (tab) {
    if (!/^\d+(\.\d{1,2})?$/.test(tab)) return err("bad_tab");
    tabCents = Math.round(Number(tab) * 100);
    if (tabCents < 1 || tabCents > 100_000) return err("bad_tab");
  }
  const sponsorId = fields.sponsor || null;
  if (tabCents !== null && sponsorId === null) return err("tab_needs_sponsor");
  return ok({
    weekOf: fields.day,
    teamSeasonId: fields.team,
    sponsorId,
    tabCents,
    reason,
  });
}

export const TEAM_OF_WEEK_ERRORS: Record<TeamOfWeekFormError, string> = {
  bad_day: "Pick a game day.",
  no_team: "Pick a team.",
  reason_missing: "Say why they earned it, in a line.",
  reason_too_long: "Keep the reason to 280 characters.",
  bad_tab: "Give the tab in dollars, up to $1,000, or leave it empty.",
  tab_needs_sponsor: "Say which sponsor is putting up the tab.",
};
