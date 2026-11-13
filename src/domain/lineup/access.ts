import { can, type Subject } from "../authz/permissions";
import { localDate } from "../scheduler/slots";

/** From the start of the game's day in the league's time zone, and after. */
export function isGameDay(
  startsAt: Date | null,
  now: Date,
  timeZone: string,
): boolean {
  if (startsAt === null) return false;
  return localDate(now, timeZone) >= localDate(startsAt, timeZone);
}

/**
 * What a person may do with one team's kicking order for a game:
 * - `edit`: build and save it, seeing each player's lineup gender (the
 *   team's captains and admins).
 * - `order`: see the saved order, names only (from game day, the other
 *   team's captains and the game's ref).
 * - `none`: nothing beyond their own spot, which every kicker sees.
 */
export type LineupAccess = "edit" | "order" | "none";

export function lineupAccess(
  subject: Subject,
  g: {
    id: string;
    teamAId: string;
    teamBId: string;
    startsAt: Date | null;
    timeZone: string;
  },
  teamSeasonId: string,
  now: Date,
): LineupAccess {
  if (teamSeasonId !== g.teamAId && teamSeasonId !== g.teamBId) return "none";
  if (can(subject, "lineup.edit", { teamSeasonId })) return "edit";
  const context = {
    teamSeasonId,
    game: {
      id: g.id,
      teamSeasonIds: [g.teamAId, g.teamBId] as const,
      gameDay: isGameDay(g.startsAt, now, g.timeZone),
    },
  };
  return can(subject, "lineup.view_order", context) ? "order" : "none";
}
