import { aliasedTable, and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { checkInName, type PackRow } from "@/domain/gameday/pack";
import type { LeagueId, TeamSeasonId } from "@/domain/ids";
import { user } from "../schema/auth";
import { field, game, refereeAssignment, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { permitWindow } from "../schema/schedule";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import type { Db } from "./schedule";

/**
 * The printable game-day pack (issue #377). Callers check `season.manage`.
 * Two reads at most: every game on the day with its field, ref and permit,
 * then, only for the check-in sheets, the rosters of the teams playing.
 */

const teamA = aliasedTable(team, "team_a");
const teamB = aliasedTable(team, "team_b");
const entryA = aliasedTable(teamSeason, "entry_a");
const entryB = aliasedTable(teamSeason, "entry_b");

/** A slot's local date in the league's time zone. */
const localDay = sql`(${slot.startsAt} at time zone ${league.timezone})::date`;

/**
 * Every game placed on `date` (YYYY-MM-DD, league time), the same games the
 * game-day screen shows, with the permit its slot was cut from.
 */
export async function packRows(
  db: Db,
  leagueId: LeagueId,
  date: string,
): Promise<PackRow[]> {
  const rows = await db
    .select({
      id: game.id,
      startsAt: slot.startsAt,
      fieldId: field.id,
      fieldName: field.name,
      venueName: venue.name,
      teamAId: game.teamAId,
      teamBId: game.teamBId,
      teamA: teamA.name,
      teamB: teamB.name,
      kicksFirst: game.kicksFirst,
      calledOff: sql<boolean>`(${slot.status} = 'cancelled' or ${game.status} = 'cancelled')`,
      refFirst: profile.firstName,
      refLast: profile.lastName,
      refAccount: user.name,
      permitId: permitWindow.id,
      permitNumber: permitWindow.permitNumber,
      permitStatus: permitWindow.status,
      permitFile: permitWindow.documentFileId,
    })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(field, eq(slot.fieldId, field.id))
    .innerJoin(venue, eq(field.venueId, venue.id))
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .innerJoin(entryA, eq(game.teamAId, entryA.id))
    .innerJoin(teamA, eq(entryA.teamId, teamA.id))
    .innerJoin(entryB, eq(game.teamBId, entryB.id))
    .innerJoin(teamB, eq(entryB.teamId, teamB.id))
    .leftJoin(permitWindow, eq(permitWindow.id, slot.permitWindowId))
    .leftJoin(
      refereeAssignment,
      and(
        eq(refereeAssignment.gameId, game.id),
        eq(refereeAssignment.status, "accepted"),
      ),
    )
    .leftJoin(user, eq(user.id, refereeAssignment.userId))
    .leftJoin(profile, eq(profile.userId, refereeAssignment.userId))
    .where(
      and(
        eq(league.id, leagueId),
        ne(season.status, "draft"),
        sql`${localDay} = ${date}::date`,
      ),
    )
    .orderBy(asc(slot.startsAt), asc(field.name));
  return rows.map((r) => ({
    id: r.id,
    startsAt: r.startsAt,
    fieldId: r.fieldId,
    fieldName: r.fieldName,
    venueName: r.venueName,
    teamA: r.teamA,
    teamB: r.teamB,
    teamAId: r.teamAId,
    teamBId: r.teamBId,
    kicksFirst:
      r.kicksFirst === null ? null : r.kicksFirst === r.teamAId ? "A" : "B",
    referee:
      r.refAccount === null && r.refFirst === null
        ? null
        : checkInName(r.refFirst, r.refLast, r.refAccount),
    calledOff: r.calledOff,
    permit:
      r.permitId === null || r.permitStatus === null
        ? null
        : {
            number: r.permitNumber,
            status: r.permitStatus,
            onFile: r.permitFile !== null,
          },
  }));
}

export type CheckInSheet = {
  teamSeasonId: string;
  players: { name: string; role: "captain" | "co_captain" | "player" }[];
};

/**
 * The active players of each team, first name and last initial, captains
 * first: one read for every team on the day.
 */
export async function packRosters(
  db: Db,
  teamSeasonIds: readonly TeamSeasonId[],
): Promise<CheckInSheet[]> {
  if (teamSeasonIds.length === 0) return [];
  const rows = await db
    .select({
      teamSeasonId: rosterMembership.teamSeasonId,
      role: rosterMembership.role,
      firstName: profile.firstName,
      lastName: profile.lastName,
      account: user.name,
    })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .innerJoin(user, eq(user.id, registration.userId))
    .leftJoin(profile, eq(profile.userId, registration.userId))
    .where(
      and(
        inArray(rosterMembership.teamSeasonId, [...teamSeasonIds]),
        eq(rosterMembership.status, "active"),
      ),
    );
  const sheets = new Map<string, CheckInSheet>(
    teamSeasonIds.map((id) => [id, { teamSeasonId: id, players: [] }]),
  );
  for (const r of rows)
    sheets.get(r.teamSeasonId)?.players.push({
      name: checkInName(r.firstName, r.lastName, r.account),
      role: r.role,
    });
  const rank = { captain: 0, co_captain: 1, player: 2 } as const;
  for (const sheet of sheets.values())
    sheet.players.sort(
      (a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name),
    );
  return [...sheets.values()];
}
