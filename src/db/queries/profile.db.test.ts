import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { UserId } from "@/domain/ids";
import type { ProfileSettings } from "@/domain/profile/profile-form";
import { user } from "../schema/auth";
import { profile } from "../schema/profile";
import { closePool, inRolledBackDb } from "../test/transaction";
import { profileOf, saveProfile } from "./profile";

afterAll(closePool);

const settings: ProfileSettings = {
  firstName: "Robin",
  lastName: "Example",
  phoneE164: "+17185550123",
  gender: "nonbinary",
  lineupGender: "woman",
  shirtSize: "m",
  birthDate: "1995-06-15",
  emergencyContactName: "Sam Example",
  emergencyContactPhone: "+17185550199",
};

describe("profile", () => {
  it("saves a profile, renames the account, and unverifies a changed phone", async () => {
    await inRolledBackDb(async (db) => {
      const tag = Math.random().toString(36).slice(2, 8);
      const [person] = await db
        .insert(user)
        .values({ name: "", email: `profile-${tag}@example.test` })
        .returning({ id: user.id });
      const id = person!.id as UserId;

      // No profile row yet: saving creates it.
      expect(await profileOf(db, id)).toMatchObject({ firstName: null });
      await saveProfile(db, id, settings);
      expect(await profileOf(db, id)).toMatchObject({
        email: `profile-${tag}@example.test`,
        firstName: "Robin",
        lineupGender: "woman",
        birthDate: "1995-06-15",
      });
      const [named] = await db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, id));
      expect(named?.name).toBe("Robin Example");

      const verified = new Date("2026-11-01T00:00:00Z");
      await db
        .update(profile)
        .set({ phoneVerifiedAt: verified })
        .where(eq(profile.userId, id));
      await saveProfile(db, id, { ...settings, shirtSize: "l" });
      expect((await profileOf(db, id))?.phoneVerifiedAt).toEqual(verified);
      await saveProfile(db, id, { ...settings, phoneE164: "+17185550124" });
      expect((await profileOf(db, id))?.phoneVerifiedAt).toBeNull();

      expect(
        await profileOf(db, "00000000-0000-0000-0000-000000000000" as UserId),
      ).toBeNull();
    });
  });
});
