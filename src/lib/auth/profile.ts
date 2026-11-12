import { profile, type NewProfile } from "@/db/schema";
import type { UserId } from "@/domain/ids";

/** The profile a new user starts with. Name, gender and the rest are filled in at registration. */
export const initialProfile = (userId: UserId): NewProfile => ({
  userId,
  globalRole: "player",
});

/** The part of a Drizzle database this needs, so tests can pass a fake. */
export type ProfileWriter = {
  insert: (table: typeof profile) => {
    values: (values: NewProfile) => {
      onConflictDoNothing: () => PromiseLike<unknown>;
    };
  };
};

/**
 * Runs after Better Auth creates a user. Idempotent: a retried hook or a
 * second call never creates a duplicate or fails.
 */
export async function createProfileForUser(
  db: ProfileWriter,
  userId: UserId,
): Promise<void> {
  await db.insert(profile).values(initialProfile(userId)).onConflictDoNothing();
}
