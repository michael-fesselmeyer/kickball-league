import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Db } from "@/db/queries/schedule";
import { closePool, inRolledBackDb } from "@/db/test/transaction";
import { RATE_LIMIT } from "./config";
import { socialProviders } from "./google";
import { parseSetCookie, requestGoogleSignIn } from "./request-google";

afterAll(closePool);

const BASE = "http://localhost:3000";

/** The site's Google sign-in, with limits on as in production. */
const instance = (db: Db) =>
  betterAuth({
    baseURL: BASE,
    // Placeholders of the required shape, not real values.
    secret: "x".repeat(32),
    socialProviders: socialProviders({
      GOOGLE_CLIENT_ID: "placeholder-client.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "placeholder-secret",
    }),
    database: drizzleAdapter(db, { provider: "pg", schema }),
    advanced: {
      database: { generateId: "uuid" },
      disableOriginCheck: false,
    },
    rateLimit: { ...RATE_LIMIT, enabled: true },
    telemetry: { enabled: false },
  });

const start = (auth: ReturnType<typeof instance>, ip: string) =>
  requestGoogleSignIn(auth.handler, {
    baseURL: BASE,
    callbackURL: "/app",
    headers: new Headers({ "x-forwarded-for": ip }),
  });

describe("requestGoogleSignIn", () => {
  it("sends the browser to Google with the state cookie", async () => {
    await inRolledBackDb(async (db) => {
      const begun = await start(instance(db), "203.0.113.60");
      if (begun.outcome !== "redirect") throw new Error(begun.outcome);
      expect(new URL(begun.url).hostname).toBe("accounts.google.com");
      const cookies = begun.setCookies.flatMap((c) => {
        const parsed = parseSetCookie(c);
        return parsed ? [parsed] : [];
      });
      expect(cookies.map((c) => c.name).join(" ")).toMatch(/state/);
      expect(cookies.every((c) => c.options.httpOnly)).toBe(true);
    });
  });

  it("refuses a burst of starts from one address, as other sign-ins", async () => {
    await inRolledBackDb(async (db) => {
      const auth = instance(db);
      const outcomes = [];
      for (let i = 0; i < 4; i += 1)
        outcomes.push((await start(auth, "203.0.113.61")).outcome);
      expect(outcomes).toEqual([
        "redirect",
        "redirect",
        "redirect",
        "rate_limited",
      ]);
      expect((await start(auth, "203.0.113.62")).outcome).toBe("redirect");
    });
  });
});

describe("parseSetCookie", () => {
  it("reads the name, value and attributes Next needs", () => {
    expect(
      parseSetCookie(
        "__Secure-x.state=abc=def; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax",
      ),
    ).toEqual({
      name: "__Secure-x.state",
      value: "abc=def",
      options: {
        maxAge: 600,
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      },
    });
    expect(parseSetCookie("=nameless")).toBeNull();
  });
});
