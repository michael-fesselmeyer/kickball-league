import { eq } from "drizzle-orm";
import type { UserId } from "@/domain/ids";
import type { ProfileSettings } from "@/domain/profile/profile-form";
import { user } from "../schema/auth";
import { profile } from "../schema/profile";
import type { Db } from "./schedule";

/** A person's own profile, as the profile screen shows it. */
export async function profileOf(db: Db, userId: UserId) {
  const [found] = await db
    .select({
      email: user.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      phoneE164: profile.phoneE164,
      phoneVerifiedAt: profile.phoneVerifiedAt,
      gender: profile.gender,
      lineupGender: profile.lineupGender,
      shirtSize: profile.shirtSize,
      birthDate: profile.birthDate,
      emergencyContactName: profile.emergencyContactName,
      emergencyContactPhone: profile.emergencyContactPhone,
    })
    .from(user)
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(eq(user.id, userId));
  return found ?? null;
}

/**
 * Saves a person's own profile and keeps their account name in step. A new
 * phone number is no longer verified.
 */
export async function saveProfile(
  db: Db,
  userId: UserId,
  settings: ProfileSettings,
): Promise<void> {
  const [before] = await db
    .select({ phoneE164: profile.phoneE164 })
    .from(profile)
    .where(eq(profile.userId, userId));
  const phoneChanged = before?.phoneE164 !== settings.phoneE164;
  await db
    .insert(profile)
    .values({ userId, ...settings, createdBy: userId })
    .onConflictDoUpdate({
      target: profile.userId,
      set: {
        ...settings,
        ...(phoneChanged ? { phoneVerifiedAt: null } : {}),
      },
    });
  await db
    .update(user)
    .set({ name: `${settings.firstName} ${settings.lastName}` })
    .where(eq(user.id, userId));
}
