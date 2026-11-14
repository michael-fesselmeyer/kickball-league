import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { closePool, inRolledBackDb } from "@/db/test/transaction";
import type { Db } from "@/db/queries/schedule";
import { RATE_LIMIT, SIGN_IN_LINKS_PER_IP } from "./config";
import { withinInboxLimit } from "./magic-link";
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
        sendMagicLink: withinInboxLimit(db, async ({ email }) => {
          sent.push(email);
        }),
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

const inbox = (n: number) => `player-${n}@example.test`;

describe("requestSignInLink", () => {
  it("sends a day's links from one IP address, then refuses", async () => {
    await inRolledBackDb(async (db) => {
      const sent: string[] = [];
      const auth = instance(db, sent);
      const ip = "203.0.113.20";
      const outcomes = [];
      for (let i = 0; i < SIGN_IN_LINKS_PER_IP.max; i += 1)
        outcomes.push(await ask(auth, ip, inbox(i)));
      expect(outcomes).toEqual(Array(SIGN_IN_LINKS_PER_IP.max).fill("sent"));

      // The next one is refused and no email goes out.
      expect(await ask(auth, ip, inbox(99))).toBe("rate_limited");
      expect(sent).toHaveLength(SIGN_IN_LINKS_PER_IP.max);

      // Another IP address has its own allowance.
      expect(await ask(auth, "203.0.113.21", inbox(99))).toBe("sent");
    });
  });

  it("sends an inbox only a few links, from any number of addresses", async () => {
    await inRolledBackDb(async (db) => {
      const sent: string[] = [];
      const auth = instance(db, sent);
      const target = "Target@Example.test";
      const outcomes = [];
      for (let i = 0; i < 4; i += 1)
        outcomes.push(await ask(auth, `203.0.113.${40 + i}`, target));
      expect(outcomes).toEqual(["sent", "sent", "sent", "rate_limited"]);
      expect(sent).toHaveLength(3);
      // The same inbox however it is written; other inboxes are unaffected.
      expect(await ask(auth, "203.0.113.50", "target@example.test")).toBe(
        "rate_limited",
      );
      expect(await ask(auth, "203.0.113.50", inbox(1))).toBe("sent");
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
