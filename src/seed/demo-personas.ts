import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import {
  profile,
  refereeAssignment,
  registration,
  rosterMembership,
  teamSeason,
  user,
  waiverSignature,
} from "@/db/schema";
import type {
  RefereeAssignmentId,
  RegistrationId,
  RosterMembershipId,
  UserId,
} from "@/domain/ids";
import { PERSONA_EMAILS, PERSONAS, type PersonaKey } from "@/lib/demo/personas";
import { PLAYED_ROUNDS, type SeedData } from "./generate";

/**
 * The four people a demo visitor can view the league as
 * (src/lib/demo/personas.ts), added on top of the generated league:
 * - Pat Player and Casey Captain on the first team, Casey as its captain
 *   (the generated captain steps down to co-captain, and the team's target
 *   roster grows by two).
 * - Reese Ref referees the last played round and the next one, so there are
 *   finished games and games waiting for a score.
 * - Addie Admin runs the league.
 * Fixed ids, so the personas are the same people after every reset.
 */
const PERSONA_IDS: Record<PersonaKey, UserId> = {
  player: "d3e30000-0000-4000-8000-000000000001" as UserId,
  captain: "d3e30000-0000-4000-8000-000000000002" as UserId,
  ref: "d3e30000-0000-4000-8000-000000000003" as UserId,
  admin: "d3e30000-0000-4000-8000-000000000004" as UserId,
};

const rowId = <T extends string>(n: number) =>
  `d3e30000-0000-4000-8000-${String(n).padStart(12, "0")}` as T;

export function demoPersonaRows(data: SeedData) {
  const team = data.teamSeasons[0];
  if (!team) throw new Error("The seed has no teams");
  const handOff = data.rosterMemberships.find(
    (m) => m.teamSeasonId === team.id && m.role === "captain",
  );
  if (!handOff) throw new Error("The first team has no captain");

  const users = (Object.keys(PERSONA_IDS) as PersonaKey[]).map((key) => ({
    id: PERSONA_IDS[key],
    name: `${PERSONAS[key].firstName} ${PERSONAS[key].lastName}`,
    email: PERSONAS[key].email,
    emailVerified: true,
  }));
  const profiles = [
    { key: "player", gender: "woman", lineupGender: "woman" },
    { key: "captain", gender: "man", lineupGender: "man" },
    { key: "ref", gender: "nonbinary", lineupGender: "woman" },
    { key: "admin", gender: "woman", lineupGender: "woman" },
  ].map(({ key, gender, lineupGender }) => ({
    userId: PERSONA_IDS[key as PersonaKey],
    firstName: PERSONAS[key as PersonaKey].firstName,
    lastName: PERSONAS[key as PersonaKey].lastName,
    gender: gender as "woman" | "man" | "nonbinary",
    lineupGender: lineupGender as "woman" | "man",
    shirtSize: "m" as const,
    globalRole: key === "admin" ? ("admin" as const) : ("player" as const),
  }));

  const onTeam = [
    { key: "captain", role: "captain", n: 101 },
    { key: "player", role: "player", n: 102 },
  ] as const;
  const registrations = onTeam.map(({ key, n }) => ({
    id: rowId<RegistrationId>(n),
    seasonId: data.season.id,
    userId: PERSONA_IDS[key],
    kind: "team_member" as const,
    status: "active" as const,
  }));
  const rosterMemberships = onTeam.map(({ role, n }) => ({
    id: rowId<RosterMembershipId>(n + 100),
    teamSeasonId: team.id,
    registrationId: rowId<RegistrationId>(n),
    role,
    status: "active" as const,
    startedAt: new Date("2026-08-20T16:00:00Z"),
    sharesContact: true,
  }));

  const refereedRounds = [PLAYED_ROUNDS, PLAYED_ROUNDS + 1];
  const refereeAssignments = data.games
    .filter((g) => refereedRounds.includes(g.roundNo))
    .map((g, i) => ({
      id: rowId<RefereeAssignmentId>(301 + i),
      gameId: g.id,
      userId: PERSONA_IDS.ref,
      status: "accepted" as const,
      respondedAt: new Date("2026-08-25T16:00:00Z"),
    }));

  return {
    users,
    profiles,
    registrations,
    rosterMemberships,
    refereeAssignments,
    /** The generated captain's spot, which becomes co-captain. */
    handOffMembershipId: handOff.id,
    /** The first team grows by the two personas, so it is not over target. */
    team: {
      id: team.id,
      targetRosterSize: team.targetRosterSize + onTeam.length,
    },
  };
}

/**
 * Removes the personas from a previous seed. Runs after the demo league is
 * deleted, so only their waiver signatures can still hold on to them.
 */
export async function removeDemoPersonas(db: Db): Promise<void> {
  const ids = (
    await db
      .select({ id: user.id })
      .from(user)
      .where(inArray(user.email, [...PERSONA_EMAILS]))
  ).map((r) => r.id);
  if (!ids.length) return;
  await db
    .update(registration)
    .set({ waiverSignatureId: null })
    .where(inArray(registration.userId, ids));
  await db.delete(waiverSignature).where(inArray(waiverSignature.userId, ids));
  // Profiles, sessions and accounts cascade.
  await db.delete(user).where(inArray(user.id, ids));
}

/** Adds the personas to a freshly seeded demo league. */
export async function addDemoPersonas(db: Db, data: SeedData): Promise<void> {
  const rows = demoPersonaRows(data);
  await db.insert(user).values(rows.users);
  await db.insert(profile).values(rows.profiles);
  await db.insert(registration).values(rows.registrations);
  // One active captain per team: the generated one steps aside first.
  await db
    .update(rosterMembership)
    .set({ role: "co_captain" })
    .where(
      and(
        eq(rosterMembership.id, rows.handOffMembershipId),
        eq(rosterMembership.role, "captain"),
      ),
    );
  await db.insert(rosterMembership).values(rows.rosterMemberships);
  await db
    .update(teamSeason)
    .set({ targetRosterSize: rows.team.targetRosterSize })
    .where(eq(teamSeason.id, rows.team.id));
  await db.insert(refereeAssignment).values(rows.refereeAssignments);
}
