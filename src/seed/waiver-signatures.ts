import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import {
  profile,
  registration,
  rosterMembership,
  user,
  waiverSignature,
} from "@/db/schema";
import type { SeedData } from "./generate";
import { PERSONA_IDS } from "./demo-personas";

/**
 * Rostered, paid players have signed the in-progress season's waiver, as
 * real ones must before they pay, so the game-day check-in flags only the
 * people who really haven't (#553). Two players are left unsigned on
 * purpose, one of them on the demo captain's team, so the check-in's
 * warning still has someone to show. Each signature is linked from its
 * registration, as signing in the app does. Runs after the personas join.
 */
export async function addSeedWaiverSignatures(
  db: Db,
  data: SeedData,
): Promise<number> {
  const rows = await db
    .select({
      registrationId: registration.id,
      userId: registration.userId,
      teamSeasonId: rosterMembership.teamSeasonId,
      first: profile.firstName,
      last: profile.lastName,
      account: user.name,
    })
    .from(registration)
    .innerJoin(
      rosterMembership,
      and(
        eq(rosterMembership.registrationId, registration.id),
        eq(rosterMembership.status, "active"),
      ),
    )
    .innerJoin(user, eq(user.id, registration.userId))
    .leftJoin(profile, eq(profile.userId, registration.userId))
    .where(
      and(
        eq(registration.seasonId, data.season.id),
        eq(registration.status, "active"),
        isNull(registration.waiverSignatureId),
      ),
    )
    .orderBy(asc(rosterMembership.teamSeasonId), asc(registration.createdAt));

  // The last player listed on the captain's team and on one other team.
  const captainTeam = rows.find(
    (r) => r.userId === PERSONA_IDS.captain,
  )?.teamSeasonId;
  const unsigned = new Set<string>();
  const lastOf = (teamSeasonId: string | undefined) =>
    rows
      .filter(
        (r) =>
          r.teamSeasonId === teamSeasonId &&
          !Object.values(PERSONA_IDS).includes(r.userId),
      )
      .at(-1)?.registrationId;
  const otherTeam = rows.find(
    (r) => r.teamSeasonId !== captainTeam,
  )?.teamSeasonId;
  for (const id of [lastOf(captainTeam), lastOf(otherTeam)])
    if (id) unsigned.add(id);

  const seen = new Set<string>();
  const signing = rows.filter((r) => {
    if (unsigned.has(r.registrationId) || seen.has(r.registrationId))
      return false;
    seen.add(r.registrationId);
    return true;
  });
  const signedAt = new Date(`${data.season.startsOn}T00:00:00Z`);
  signedAt.setUTCDate(signedAt.getUTCDate() - 14);
  if (signing.length === 0) return 0;
  await db.insert(waiverSignature).values(
    signing.map((r) => ({
      waiverId: data.waiver.id,
      userId: r.userId,
      seasonId: data.season.id,
      signedName:
        [r.first, r.last].filter(Boolean).join(" ") || r.account || "Player",
      signedAt,
      bodySha256: data.waiver.bodySha256,
      ageConfirmedMin: 21,
      ageConfirmedAt: signedAt,
    })),
  );
  await db
    .update(registration)
    .set({ waiverSignatureId: waiverSignature.id })
    .from(waiverSignature)
    .where(
      and(
        inArray(
          registration.id,
          signing.map((r) => r.registrationId),
        ),
        eq(waiverSignature.userId, registration.userId),
        eq(waiverSignature.seasonId, registration.seasonId),
      ),
    );
  return signing.length;
}
