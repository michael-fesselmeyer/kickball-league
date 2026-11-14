import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { RATE_LIMIT, RATE_LIMIT_KEEP_MS } from "@/lib/auth/config";
import * as schema from "../schema";
import { rateLimit } from "../schema/auth";
import { closePool, inRolledBackDb } from "../test/transaction";
import { pruneRateLimits } from "./rate-limit";
import type { Db } from "./schedule";

afterAll(closePool);

/**
 * A Better Auth instance with the site's rate-limit storage, as a second
 * server instance would have it: its own process memory, the same database.
 */
const instance = (db: Db) =>
  betterAuth({
    baseURL: "http://localhost:3000",
    // A placeholder of the required length, not a real value.
    secret: "x".repeat(32),
    database: drizzleAdapter(db, { provider: "pg", schema }),
    advanced: { database: { generateId: "uuid" } },
    // Limits are on in production only; the test turns them on.
    rateLimit: { ...RATE_LIMIT, enabled: true },
    plugins: [magicLink({ sendMagicLink: async () => {} })],
    telemetry: { enabled: false },
  });

/** A magic-link check with a made-up token, from a documentation-range IP. */
const verify = (auth: ReturnType<typeof instance>, ip: string) =>
  auth.handler(
    new Request(
      "http://localhost:3000/api/auth/magic-link/verify?token=not-a-token",
      { headers: { "x-forwarded-for": ip } },
    ),
  );

describe("sign-in rate limit", () => {
  it("counts requests to every instance against one limit", async () => {
    await inRolledBackDb(async (db) => {
      const first = instance(db);
      const second = instance(db);
      const ip = "203.0.113.7";
      // Five magic-link checks a minute per IP, split across instances.
      const statuses = [];
      for (const auth of [first, second, first, second, first])
        statuses.push((await verify(auth, ip)).status);
      expect(statuses).not.toContain(429);

      const sixth = await verify(second, ip);
      expect(sixth.status).toBe(429);
      expect(Number(sixth.headers.get("X-Retry-After"))).toBeGreaterThan(0);

      const rows = await db.select().from(rateLimit);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.count).toBe(5);
      // Another address has a count of its own.
      expect((await verify(first, "203.0.113.8")).status).not.toBe(429);
    });
  });

  it("sweeps counters untouched for a day", async () => {
    await inRolledBackDb(async (db) => {
      const now = new Date("2027-05-01T12:00:00Z");
      await db.insert(rateLimit).values([
        {
          key: "203.0.113.7|/magic-link/verify",
          count: 5,
          lastRequest: now.getTime() - RATE_LIMIT_KEEP_MS - 1,
        },
        {
          key: "203.0.113.8|/magic-link/verify",
          count: 1,
          lastRequest: now.getTime() - 60_000,
        },
      ]);
      expect(await pruneRateLimits(db, now)).toBe(1);
      const left = await db
        .select({ key: rateLimit.key })
        .from(rateLimit)
        .where(eq(rateLimit.count, 1));
      expect(left).toEqual([{ key: "203.0.113.8|/magic-link/verify" }]);
      expect(await db.select().from(rateLimit)).toHaveLength(1);
    });
  });
});
