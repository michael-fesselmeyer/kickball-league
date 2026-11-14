import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import { eq, like } from "drizzle-orm";
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { verification } from "@/db/schema/auth";
import { closePool, inRolledBackDb } from "@/db/test/transaction";
import type { Db } from "@/db/queries/schedule";
import {
  MAGIC_LINK_STORE_TOKEN,
  RATE_LIMIT,
  SIGN_IN_LINKS_PER_IP,
} from "./config";
import { withinInboxLimit } from "./magic-link";
import { requestSignInLink } from "./request-link";

afterAll(closePool);

const BASE = "http://localhost:3000";

/** The site's sign-in setup, with limits on as in production. */
const instance = (db: Db, sent: string[], tokens: string[] = []) =>
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
        storeToken: MAGIC_LINK_STORE_TOKEN,
        sendMagicLink: withinInboxLimit(db, async ({ email, url }) => {
          sent.push(email);
          const token = new URL(url).searchParams.get("token");
          if (token) tokens.push(token);
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

  it("stores only a hash of the link's token, so a copy of the database signs nobody in", async () => {
    await inRolledBackDb(async (db) => {
      const sent: string[] = [];
      const tokens: string[] = [];
      const auth = instance(db, sent, tokens);
      expect(await ask(auth, "203.0.113.23", inbox(7))).toBe("sent");
      const [token] = tokens;
      if (!token) throw new Error("no link was sent");
      const hashed = createHash("sha256").update(token).digest("base64url");
      const rows = await db
        .select({ identifier: verification.identifier })
        .from(verification)
        .where(like(verification.identifier, "magic-link:%"));
      const ids = rows.map((r) => r.identifier);
      expect(ids).toContain(`magic-link:${hashed}`);
      expect(ids).not.toContain(`magic-link:${token}`);
      // The emailed link still signs in, once.
      const verify = (t: string) =>
        auth.handler(
          new Request(
            `${BASE}/api/auth/magic-link/verify?token=${t}&callbackURL=/app`,
            { headers: { "x-forwarded-for": "203.0.113.23" } },
          ),
        );
      const used = await verify(token);
      expect(used.headers.get("location")).toBe(`${BASE}/app`);
      expect(
        await db
          .select({ id: verification.id })
          .from(verification)
          .where(eq(verification.identifier, `magic-link:${hashed}`)),
      ).toEqual([]);
    });
  });
});
