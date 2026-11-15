import { and, eq } from "drizzle-orm";
import {
  type GlobalRole,
  type Subject,
  VISITOR,
} from "@/domain/authz/permissions";
import type { LeagueId, UserId } from "@/domain/ids";
import { actingPowersOf } from "./acting-admin";
import { game, refereeAssignment } from "../schema/game";
import { leagueMember } from "../schema/league";
import { refereeProfile } from "../schema/referees";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { registration, rosterMembership, teamSeason } from "../schema/team";
import type { Db } from "./schedule";
import { sponsorIdsOf } from "./sponsors";

/**
 * The person an action is aimed at, for the permissions matrix: who they
 * are and their role in the league. An acting admin may not act on
 * themselves or on staff (issue #468).
 */
export async function targetOf(
  db: Db,
  userId: UserId,
  leagueId: string | null,
): Promise<{ targetUserId: UserId; targetGlobalRole: GlobalRole }> {
  const [row] =
    leagueId === null
      ? []
      : await db
          .select({ role: leagueMember.role })
          .from(leagueMember)
          .where(
            and(
              eq(leagueMember.userId, userId),
              eq(leagueMember.leagueId, leagueId as LeagueId),
            ),
          );
  return { targetUserId: userId, targetGlobalRole: row?.role ?? "player" };
}

/**
 * Who a person is for permission checks in one league (ADR 0048): their
 * role there, and their active roster roles, refereed games, place in the
 * ref pool (ADR 0053) and managed sponsors in that league only. A missing
 * user is treated as a visitor.
 */
export async function loadSubject(
  db: Db,
  userId: UserId | null,
  leagueId: LeagueId,
  now: Date = new Date(),
): Promise<Subject> {
  if (userId === null) return VISITOR;
  const [[person], roster, refereeing, [pooled], sponsors, acting] =
    await Promise.all([
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
      // In the league's ref pool, so they can say when they can work before
      // their first game (ADR 0053).
      db
        .select({ userId: refereeProfile.userId })
        .from(refereeProfile)
        .where(
          and(
            eq(refereeProfile.userId, userId),
            eq(refereeProfile.leagueId, leagueId),
          ),
        )
        .limit(1),
      sponsorIdsOf(db, userId, leagueId),
      actingPowersOf(db, userId, leagueId, now),
    ]);
  if (!person) return VISITOR;
  return {
    ...VISITOR,
    userId,
    leagueId,
    globalRole: person.role ?? "player",
    roster,
    isReferee: refereeing.length > 0 || pooled !== undefined,
    refereeGameIds: refereeing.map((r) => r.gameId),
    sponsorIds: sponsors,
    // Only a player acts for the admins; an admin or owner already has more.
    ...((person.role ?? "player") === "player" && acting.length > 0
      ? { acting }
      : {}),
  };
}
