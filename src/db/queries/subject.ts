import { and, eq } from "drizzle-orm";
import { type Subject, VISITOR } from "@/domain/authz/permissions";
import type { LeagueId, UserId } from "@/domain/ids";
import { game, refereeAssignment } from "../schema/game";
import { leagueMember } from "../schema/league";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { registration, rosterMembership, teamSeason } from "../schema/team";
import type { Db } from "./schedule";
import { sponsorIdsOf } from "./sponsors";

/**
 * Who a person is for permission checks in one league (ADR 0048): their
 * role there, and their active roster roles, refereed games and managed
 * sponsors in that league only. A missing user is treated as a visitor.
 */
export async function loadSubject(
  db: Db,
  userId: UserId | null,
  leagueId: LeagueId,
): Promise<Subject> {
  if (userId === null) return VISITOR;
  const [[person], roster, refereeing, sponsors] = await Promise.all([
    db
      .select({ role: leagueMember.role })
      .from(profile)
      .leftJoin(
        leagueMember,
        and(
          eq(leagueMember.userId, profile.userId),
          eq(leagueMember.leagueId, leagueId),
        ),
      )
      .where(eq(profile.userId, userId)),
    db
      .select({
        teamSeasonId: rosterMembership.teamSeasonId,
        role: rosterMembership.role,
      })
      .from(rosterMembership)
      .innerJoin(
        registration,
        eq(rosterMembership.registrationId, registration.id),
      )
      .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
      .innerJoin(season, eq(teamSeason.seasonId, season.id))
      .where(
        and(
          eq(registration.userId, userId),
          eq(rosterMembership.status, "active"),
          eq(season.leagueId, leagueId),
        ),
      )
      .orderBy(rosterMembership.teamSeasonId),
    db
      .select({ gameId: refereeAssignment.gameId })
      .from(refereeAssignment)
      .innerJoin(game, eq(refereeAssignment.gameId, game.id))
      .innerJoin(season, eq(game.seasonId, season.id))
      .where(
        and(
          eq(refereeAssignment.userId, userId),
          eq(refereeAssignment.status, "accepted"),
          eq(season.leagueId, leagueId),
        ),
      )
      .orderBy(refereeAssignment.gameId),
    sponsorIdsOf(db, userId, leagueId),
  ]);
  if (!person) return VISITOR;
  return {
    ...VISITOR,
    userId,
    leagueId,
    globalRole: person.role ?? "player",
    roster,
    isReferee: refereeing.length > 0,
    refereeGameIds: refereeing.map((r) => r.gameId),
    sponsorIds: sponsors,
  };
}
