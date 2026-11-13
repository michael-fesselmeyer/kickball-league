import { afterAll, describe, expect, it } from "vitest";
import { passkey, user } from "../schema/auth";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  hasPasskey,
  passkeysOf,
  removePasskey,
  renamePasskey,
} from "./passkeys";
import type { Db } from "./schedule";

afterAll(closePool);

async function person(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [row] = await db
    .insert(user)
    .values({ name: "", email: `passkeys-${tag}@example.test` })
    .returning({ id: user.id });
  return row!.id;
}

async function addPasskey(
  db: Db,
  userId: Awaited<ReturnType<typeof person>>,
  name: string,
  deviceType: "singleDevice" | "multiDevice",
  createdAt: Date,
) {
  const [row] = await db
    .insert(passkey)
    .values({
      userId,
      name,
      publicKey: `public-key-${name}`,
      credentialID: `credential-${Math.random()}`,
      counter: 0,
      deviceType,
      backedUp: deviceType === "multiDevice",
      createdAt,
    })
    .returning({ id: passkey.id });
  return row!.id;
}

describe("passkeys", () => {
  it("lists a person's passkeys, oldest first, without key material", async () => {
    await inRolledBackDb(async (db) => {
      const me = await person(db);
      expect(await hasPasskey(db, me)).toBe(false);
      await addPasskey(
        db,
        me,
        "Laptop",
        "singleDevice",
        new Date("2026-11-02"),
      );
      await addPasskey(db, me, "Phone", "multiDevice", new Date("2026-11-01"));
      await addPasskey(
        db,
        await person(db),
        "Theirs",
        "multiDevice",
        new Date(),
      );

      const list = await passkeysOf(db, me);
      expect(list).toEqual([
        expect.objectContaining({ name: "Phone", synced: true }),
        expect.objectContaining({ name: "Laptop", synced: false }),
      ]);
      expect(JSON.stringify(list)).not.toContain("public-key");
      expect(await hasPasskey(db, me)).toBe(true);
    });
  });

  it("renames and removes only the person's own passkeys", async () => {
    await inRolledBackDb(async (db) => {
      const me = await person(db);
      const mine = await addPasskey(db, me, "Phone", "multiDevice", new Date());
      const other = await person(db);
      const theirs = await addPasskey(
        db,
        other,
        "Theirs",
        "multiDevice",
        new Date(),
      );

      expect(await renamePasskey(db, me, theirs, "Mine now")).toBe(false);
      expect(await removePasskey(db, me, theirs)).toBe(false);
      expect(await passkeysOf(db, other)).toEqual([
        expect.objectContaining({ name: "Theirs" }),
      ]);

      expect(await renamePasskey(db, me, mine, "  Work phone  ")).toBe(true);
      expect(await passkeysOf(db, me)).toEqual([
        expect.objectContaining({ name: "Work phone" }),
      ]);
      expect(await renamePasskey(db, me, mine, "x".repeat(200))).toBe(true);
      expect((await passkeysOf(db, me))[0]?.name).toHaveLength(60);

      expect(await removePasskey(db, me, mine)).toBe(true);
      expect(await passkeysOf(db, me)).toEqual([]);
    });
  });
});
