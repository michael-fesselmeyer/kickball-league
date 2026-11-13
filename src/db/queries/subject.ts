import { and, eq } from "drizzle-orm";
import { type Subject, VISITOR } from "@/domain/authz/permissions";
import type { UserId } from "@/domain/ids";
import { refereeAssignment } from "../schema/game";
import { profile } from "../schema/profile";
import { registration, rosterMembership } from "../schema/team";
import type { Db } from "./schedule";
import { sponsorIdsOf } from "./sponsors";

/**
 * Who a person is for permission checks: their global role and active roster
 * roles, the games they referee and the sponsors they manage. A missing
 * user is treated as a visitor.
 */
export async function loadSubject(
  db: Db,
  userId: UserId | null,
): Promise<Subject> {
  if (userId === null) return VISITOR;
  const [person] = await db
    .select({ globalRole: profile.globalRole })
    .from(profile)
    .where(eq(profile.userId, userId));
  if (!person) return VISITOR;
  const roster = await db
    .select({
      teamSeasonId: rosterMembership.teamSeasonId,
      role: rosterMembership.role,
    })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .where(
      and(
        eq(registration.userId, userId),
        eq(rosterMembership.status, "active"),
      ),
    )
    .orderBy(rosterMembership.teamSeasonId);
  const refereeing = await db
    .select({ gameId: refereeAssignment.gameId })
    .from(refereeAssignment)
    .where(
      and(
        eq(refereeAssignment.userId, userId),
        eq(refereeAssignment.status, "accepted"),
      ),
    )
    .orderBy(refereeAssignment.gameId);
  const sponsorIds = await sponsorIdsOf(db, userId);
  return {
    ...VISITOR,
    userId,
    globalRole: person.globalRole,
    roster,
    isReferee: refereeing.length > 0,
    refereeGameIds: refereeing.map((r) => r.gameId),
    sponsorIds,
  };
}
