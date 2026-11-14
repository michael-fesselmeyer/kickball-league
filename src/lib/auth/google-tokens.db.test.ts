import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { account, user } from "@/db/schema/auth";
import type { Db } from "@/db/queries/schedule";
import { closePool, inRolledBackDb } from "@/db/test/transaction";
import { accountHooks } from "./google";

afterAll(closePool);

/** The site's account hooks on a Better Auth instance over the test's transaction. */
const instance = (db: Db) =>
  betterAuth({
    baseURL: "http://localhost:3000",
    // A placeholder of the required length, not a real value.
    secret: "x".repeat(32),
    database: drizzleAdapter(db, { provider: "pg", schema }),
    advanced: { database: { generateId: "uuid" } },
    databaseHooks: { account: accountHooks },
    telemetry: { enabled: false },
  });

const stored = async (db: Db, id: string) =>
  (
    await db
      .select({
        accessToken: account.accessToken,
        refreshToken: account.refreshToken,
        idToken: account.idToken,
        accessTokenExpiresAt: account.accessTokenExpiresAt,
      })
      .from(account)
      .where(eq(account.id, id))
  )[0];

describe("Google's tokens", () => {
  it("are never written, when the account is linked or signed in again", async () => {
    await inRolledBackDb(async (db) => {
      const [person] = await db
        .insert(user)
        .values({ name: "Robin Example", email: "google-tokens@example.test" })
        .returning({ id: user.id });
      if (!person) throw new Error("no user");
      const { internalAdapter } = await instance(db).$context;
      // Placeholders shaped like provider tokens, not real values.
      const created = await internalAdapter.createAccount({
        userId: person.id,
        providerId: "google",
        accountId: "google-sub-1",
        accessToken: "placeholder-access",
        refreshToken: "placeholder-refresh",
        idToken: "placeholder-id",
        accessTokenExpiresAt: new Date("2027-01-01T00:00:00Z"),
      });
      expect(await stored(db, created.id)).toEqual({
        accessToken: null,
        refreshToken: null,
        idToken: null,
        accessTokenExpiresAt: null,
      });
      await internalAdapter.updateAccount(created.id, {
        accessToken: "placeholder-access-2",
        idToken: "placeholder-id-2",
      });
      expect(await stored(db, created.id)).toMatchObject({
        accessToken: null,
        idToken: null,
      });
    });
  });
});
