import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { session, user } from "../schema/auth";
import { closePool, inRolledBackDb } from "../test/transaction";
import { signOutDevice, signOutOtherDevices, signedInDevices } from "./devices";
import type { Db } from "./schedule";

afterAll(closePool);

const NOW = new Date("2026-11-12T20:00:00Z");
const HOUR = 3_600_000;
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0";

async function person(db: Db, label: string) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [row] = await db
    .insert(user)
    .values({ name: "", email: `${label}-${tag}@example.test` })
    .returning({ id: user.id });
  return row!.id;
}

async function signIn(
  db: Db,
  userId: Awaited<ReturnType<typeof person>>,
  userAgent: string | null,
  {
    usedHoursAgo,
    expiresInHours = 24,
  }: { usedHoursAgo: number; expiresInHours?: number },
) {
  const [row] = await db
    .insert(session)
    .values({
      token: `token-${Math.random().toString(36).slice(2)}`,
      userId,
      userAgent,
      createdAt: new Date(NOW.getTime() - (usedHoursAgo + 1) * HOUR),
      updatedAt: new Date(NOW.getTime() - usedHoursAgo * HOUR),
      expiresAt: new Date(NOW.getTime() + expiresInHours * HOUR),
    })
    .returning({ id: session.id });
  return row!.id;
}

describe("signed-in devices", () => {
  it("lists live sessions, most recently used first, without tokens", async () => {
    await inRolledBackDb(async (db) => {
      const me = await person(db, "devices");
      const phone = await signIn(db, me, IPHONE, { usedHoursAgo: 1 });
      const laptop = await signIn(db, me, MAC, { usedHoursAgo: 5 });
      await signIn(db, me, MAC, { usedHoursAgo: 30, expiresInHours: -1 });
      const other = await person(db, "someone-else");
      await signIn(db, other, IPHONE, { usedHoursAgo: 0 });

      const devices = await signedInDevices(db, me, laptop, NOW);
      expect(devices).toEqual([
        expect.objectContaining({
          id: phone,
          name: "iPhone · Safari",
          current: false,
        }),
        expect.objectContaining({
          id: laptop,
          name: "Mac · Firefox",
          current: true,
        }),
      ]);
      expect(Object.keys(devices[0]!)).not.toContain("token");
    });
  });

  it("signs out one other device, never the current one or someone else's", async () => {
    await inRolledBackDb(async (db) => {
      const me = await person(db, "devices");
      const phone = await signIn(db, me, IPHONE, { usedHoursAgo: 1 });
      const laptop = await signIn(db, me, MAC, { usedHoursAgo: 0 });
      const other = await person(db, "someone-else");
      const theirs = await signIn(db, other, IPHONE, { usedHoursAgo: 0 });

      expect(await signOutDevice(db, me, laptop, laptop)).toBe(false);
      expect(await signOutDevice(db, me, theirs, laptop)).toBe(false);
      expect(await signOutDevice(db, me, phone, laptop)).toBe(true);

      const left = await db
        .select({ id: session.id })
        .from(session)
        .where(eq(session.userId, me));
      expect(left).toEqual([{ id: laptop }]);
      const [stillThere] = await db
        .select({ id: session.id })
        .from(session)
        .where(eq(session.id, theirs));
      expect(stillThere).toBeDefined();
    });
  });

  it("signs out every other device and keeps this one", async () => {
    await inRolledBackDb(async (db) => {
      const me = await person(db, "devices");
      await signIn(db, me, IPHONE, { usedHoursAgo: 1 });
      await signIn(db, me, null, { usedHoursAgo: 2 });
      const laptop = await signIn(db, me, MAC, { usedHoursAgo: 0 });
      const other = await person(db, "someone-else");
      await signIn(db, other, IPHONE, { usedHoursAgo: 0 });

      expect(await signOutOtherDevices(db, me, laptop)).toBe(2);
      expect(await signedInDevices(db, me, laptop, NOW)).toEqual([
        expect.objectContaining({ id: laptop, current: true }),
      ]);
      expect(await signedInDevices(db, other, "", NOW)).toHaveLength(1);
    });
  });
});
