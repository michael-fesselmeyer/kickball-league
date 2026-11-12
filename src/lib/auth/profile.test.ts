import { describe, expect, it } from "vitest";
import { profile, type NewProfile } from "@/db/schema";
import type { UserId } from "@/domain/ids";
import {
  createProfileForUser,
  initialProfile,
  type ProfileWriter,
} from "./profile";

const userId = "8a3c1f9e-0b1d-4c2e-9f3a-5d6e7f8a9b0c" as UserId;

/** Records what would be written, and how. */
function fakeDb() {
  const calls: {
    table: unknown;
    values: NewProfile;
    onConflictDoNothing: boolean;
  }[] = [];
  const db: ProfileWriter = {
    insert: (table) => ({
      values: (values) => ({
        onConflictDoNothing: () => {
          calls.push({ table, values, onConflictDoNothing: true });
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db, calls };
}

describe("initialProfile", () => {
  it("starts every new user as a player with nothing else filled in", () => {
    expect(initialProfile(userId)).toEqual({ userId, globalRole: "player" });
  });
});

describe("createProfileForUser", () => {
  it("inserts one profile row for the new user", async () => {
    const { db, calls } = fakeDb();
    await createProfileForUser(db, userId);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.table).toBe(profile);
    expect(calls[0]?.values).toEqual({ userId, globalRole: "player" });
  });

  it("is idempotent: a repeated call ignores the existing row instead of failing", async () => {
    const { db, calls } = fakeDb();
    await createProfileForUser(db, userId);
    await createProfileForUser(db, userId);
    expect(calls.every((call) => call.onConflictDoNothing)).toBe(true);
  });
});
