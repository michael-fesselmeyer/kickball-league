import { and, eq } from "drizzle-orm";
import { type Subject, VISITOR } from "@/domain/authz/permissions";
import type { UserId } from "@/domain/ids";
import { profile } from "../schema/profile";
import { registration, rosterMembership } from "../schema/team";
import type { Db } from "./schedule";

/**
 * Who a person is for permission checks: their global role and active roster
 * roles. Referee assignments and sponsor memberships join this when those
 * tables arrive. A missing user is treated as a visitor.
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
  return {
    ...VISITOR,
    userId,
    globalRole: person.globalRole,
    roster,
  };
}
