import { eq, or } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import { profile, registration, user } from "@/db/schema";
import type { RegistrationId, UserId } from "@/domain/ids";
import type { SeedData } from "./generate";

/**
 * One invented free agent for the "not on my team" flow
 * (e2e/flows/keep-off.spec.ts): Jules Wanderer, registered for the fall
 * season with no team, so they can sub. A captain puts Jules on their
 * team's private list; no other flow uses Jules. Fixed ids in their own
 * range, so the generated league's ids stay the same. The flow names Jules
 * as plain strings; keep the two in step.
 */
export const KEEP_OFF_PERSON = {
  firstName: "Jules",
  lastName: "Wanderer",
  email: "jules.wanderer@example.test",
} as const;

const rowId = <T extends string>(n: number) =>
  `c0ff0000-0000-4000-8000-${String(n).padStart(12, "0")}` as T;
const USER_ID = rowId<UserId>(1);

export function keepOffPersonRows(data: SeedData) {
  return {
    user: {
      id: USER_ID,
      name: `${KEEP_OFF_PERSON.firstName} ${KEEP_OFF_PERSON.lastName}`,
      email: KEEP_OFF_PERSON.email,
      emailVerified: true,
    },
    profile: {
      userId: USER_ID,
      firstName: KEEP_OFF_PERSON.firstName,
      lastName: KEEP_OFF_PERSON.lastName,
      gender: "man" as const,
      lineupGender: "man" as const,
      shirtSize: "l" as const,
      globalRole: "player" as const,
    },
    registration: {
      id: rowId<RegistrationId>(2),
      seasonId: data.season.id,
      userId: USER_ID,
      kind: "free_agent" as const,
      status: "active" as const,
    },
  };
}

/**
 * Removes the person from a previous seed. Runs after the demo league is
 * deleted, which takes their registration and any list entry about them.
 */
export async function removeKeepOffPerson(db: Db): Promise<void> {
  await db
    .delete(user)
    .where(or(eq(user.id, USER_ID), eq(user.email, KEEP_OFF_PERSON.email)));
}

/** Adds the person to a freshly seeded league. */
export async function addKeepOffPerson(db: Db, data: SeedData): Promise<void> {
  const rows = keepOffPersonRows(data);
  await db.insert(user).values(rows.user);
  await db.insert(profile).values(rows.profile);
  await db.insert(registration).values(rows.registration);
}
