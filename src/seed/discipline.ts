import { eq, or } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import {
  profile,
  registration,
  rosterMembership,
  teamSeason,
  user,
} from "@/db/schema";
import type { RegistrationId, RosterMembershipId, UserId } from "@/domain/ids";
import type { SeedData } from "./generate";

/**
 * One invented player who exists for the incident and suspension flow
 * (e2e/flows/discipline.spec.ts): Dana Fairplay, on Foul Play in the fall
 * season. No other flow uses Foul Play for RSVPs, subs or the matcher, so
 * suspending Dana never changes what another flow sees. Fixed ids in their
 * own range, so the generated league's ids stay the same. The flow names
 * Dana and the team as plain strings; keep the two in step.
 */
export const DISCIPLINE_TEAM = "Foul Play";
export const DISCIPLINE_PLAYER = {
  firstName: "Dana",
  lastName: "Fairplay",
  email: "dana.fairplay@example.test",
} as const;

const rowId = <T extends string>(n: number) =>
  `d15c1000-0000-4000-8000-${String(n).padStart(12, "0")}` as T;
const USER_ID = rowId<UserId>(1);

export function disciplinePlayerRows(data: SeedData) {
  const named = data.teams.find((t) => t.name === DISCIPLINE_TEAM);
  const entry = data.teamSeasons.find((t) => t.teamId === named?.id);
  if (!entry) throw new Error(`The seed has no ${DISCIPLINE_TEAM}`);
  const registrationId = rowId<RegistrationId>(2);
  return {
    user: {
      id: USER_ID,
      name: `${DISCIPLINE_PLAYER.firstName} ${DISCIPLINE_PLAYER.lastName}`,
      email: DISCIPLINE_PLAYER.email,
      emailVerified: true,
    },
    profile: {
      userId: USER_ID,
      firstName: DISCIPLINE_PLAYER.firstName,
      lastName: DISCIPLINE_PLAYER.lastName,
      gender: "woman" as const,
      lineupGender: "woman" as const,
      shirtSize: "m" as const,
      globalRole: "player" as const,
    },
    registration: {
      id: registrationId,
      seasonId: data.season.id,
      userId: USER_ID,
      kind: "team_member" as const,
      status: "active" as const,
    },
    rosterMembership: {
      id: rowId<RosterMembershipId>(3),
      teamSeasonId: entry.id,
      registrationId,
      role: "player" as const,
      status: "active" as const,
      startedAt: new Date("2026-08-20T16:00:00Z"),
      sharesContact: false,
    },
    /** The team grows by one, so it is not over its target. */
    team: { id: entry.id, targetRosterSize: entry.targetRosterSize + 1 },
  };
}

/**
 * Removes the player from a previous seed. Runs after the demo league is
 * deleted, which takes their registration and anything filed about them.
 */
export async function removeDisciplinePlayer(db: Db): Promise<void> {
  await db
    .delete(user)
    .where(or(eq(user.id, USER_ID), eq(user.email, DISCIPLINE_PLAYER.email)));
}

/** Adds the player to a freshly seeded league. */
export async function addDisciplinePlayer(
  db: Db,
  data: SeedData,
): Promise<void> {
  const rows = disciplinePlayerRows(data);
  await db.insert(user).values(rows.user);
  await db.insert(profile).values(rows.profile);
  await db.insert(registration).values(rows.registration);
  await db.insert(rosterMembership).values(rows.rosterMembership);
  await db
    .update(teamSeason)
    .set({ targetRosterSize: rows.team.targetRosterSize })
    .where(eq(teamSeason.id, rows.team.id));
}
