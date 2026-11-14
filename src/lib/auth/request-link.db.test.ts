import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { closePool, inRolledBackDb } from "@/db/test/transaction";
import type { Db } from "@/db/queries/schedule";
import { RATE_LIMIT } from "./config";
import { requestSignInLink } from "./request-link";

afterAll(closePool);

const BASE = "http://localhost:3000";

/** The site's sign-in setup, with limits on as in production. */
const instance = (db: Db, sent: string[]) =>
  betterAuth({
    baseURL: BASE,
    // A placeholder of the required length, not a real value.
    secret: "x".repeat(32),
    database: drizzleAdapter(db, { provider: "pg", schema }),
    // Better Auth skips its origin checks under test unless told not to.
    advanced: {
      database: { generateId: "uuid" },
      disableOriginCheck: false,
    },
    rateLimit: { ...RATE_LIMIT, enabled: true },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email }) => {
          sent.push(email);
        },
      }),
    ],
    telemetry: { enabled: false },
  });

const ask = (
  auth: ReturnType<typeof instance>,
  ip: string,
  email = "player@example.test",
) =>
  requestSignInLink(auth.handler, {
    baseURL: BASE,
    email,
    callbackURL: "/app",
    headers: new Headers({ "x-forwarded-for": ip }),
  });

describe("requestSignInLink", () => {
  it("sends links until the address reaches Better Auth's limit", async () => {
    await inRolledBackDb(async (db) => {
      const sent: string[] = [];
      const auth = instance(db, sent);
      const ip = "203.0.113.20";
      const outcomes = [];
      for (let i = 0; i < 5; i += 1) outcomes.push(await ask(auth, ip));
      expect(outcomes).toEqual(Array(5).fill("sent"));

      // The sixth in a minute is refused and no email goes out, whichever
      // inbox it names.
      expect(await ask(auth, ip, "someone-else@example.test")).toBe(
        "rate_limited",
      );
      expect(sent).toHaveLength(5);

      // Another address has its own allowance.
      expect(await ask(auth, "203.0.113.21")).toBe("sent");
      expect(sent).toHaveLength(6);
    });
  });

  it("refuses a callback to another site, as the router does", async () => {
    await inRolledBackDb(async (db) => {
      const sent: string[] = [];
      const auth = instance(db, sent);
      const outcome = await requestSignInLink(auth.handler, {
        baseURL: BASE,
        email: "player@example.test",
        callbackURL: "https://elsewhere.example.test/",
        headers: new Headers({ "x-forwarded-for": "203.0.113.22" }),
      });
      expect(outcome).toBe("failed");
      expect(sent).toEqual([]);
    });
  });
});
