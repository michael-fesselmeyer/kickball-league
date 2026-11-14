import type { LeagueId, UserId } from "@/domain/ids";
import type { LeagueRole } from "@/domain/league/new-league";
import { leagueMember } from "@/db/schema/league";
import { type NewProfile, profile } from "@/db/schema/profile";
import type { Db } from "@/db/queries/schedule";

/** A seeded person's profile, with the role they hold in the seeded league. */
export type SeedProfile = NewProfile & {
  userId: UserId;
  globalRole: LeagueRole;
};

/**
 * Inserts seeded profiles, and a league role for everyone above player
 * (ADR 0048: roles belong to a league, not to the profile).
 */
export async function insertSeedProfiles(
  db: Db,
  leagueId: LeagueId,
  rows: readonly SeedProfile[],
): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(profile).values(
    rows.map((r) => {
      const p: NewProfile = { ...r };
      delete (p as Partial<SeedProfile>).globalRole;
      return p;
    }),
  );
  const staff = rows.filter((r) => r.globalRole !== "player");
  if (staff.length > 0)
    await db
      .insert(leagueMember)
      .values(
        staff.map((r) => ({ leagueId, userId: r.userId, role: r.globalRole })),
      );
}
