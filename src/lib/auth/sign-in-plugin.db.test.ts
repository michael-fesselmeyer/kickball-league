import { randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Db } from "@/db/queries/schedule";
import { closePool, inRolledBackDb } from "@/db/test/transaction";
import {
  challengeFor,
  HANDOFF_START_COOKIE,
  startCookieValue,
} from "./app-handoff";
import { MAGIC_LINK_STORE_TOKEN, RATE_LIMIT } from "./config";
import { requestCodeSignIn } from "./request-code";
import { requestSignInLink } from "./request-link";
import { issueSignInCode, leagueSignIn } from "./sign-in-plugin";

afterAll(closePool);

const BASE = "http://localhost:3000";
const SCHEME = "com.example.kickball";

type Mail = { email: string; token: string; code: string };

/** The site's sign-in setup, with limits on as in production. */
const instance = (db: Db, mail: Mail[]) =>
  betterAuth({
    baseURL: BASE,
    // A placeholder of the required length, not a real value.
    secret: "x".repeat(32),
    database: drizzleAdapter(db, { provider: "pg", schema }),
    advanced: {
      database: { generateId: "uuid" },
      disableOriginCheck: false,
    },
    rateLimit: { ...RATE_LIMIT, enabled: true },
    plugins: [
      magicLink({
        storeToken: MAGIC_LINK_STORE_TOKEN,
        sendMagicLink: async (link, ctx) => {
          const code = await issueSignInCode(ctx, link);
          mail.push({ email: link.email, token: link.token, code });
        },
      }),
      leagueSignIn(db, { appScheme: SCHEME }),
    ],
    telemetry: { enabled: false },
  });

type Auth = ReturnType<typeof instance>;

const ask = (auth: Auth, email: string, ip = "203.0.113.60") =>
  requestSignInLink(auth.handler, {
    baseURL: BASE,
    email,
    callbackURL: "/app/schedule",
    headers: new Headers({ "x-forwarded-for": ip }),
  });

const enter = (auth: Auth, email: string, code: string, ip = "203.0.113.61") =>
  requestCodeSignIn(auth.handler, {
    baseURL: BASE,
    email,
    code,
    headers: new Headers({ "x-forwarded-for": ip }),
  });

const openLink = (auth: Auth, token: string) =>
  auth.handler(
    new Request(
      `${BASE}/api/auth/magic-link/verify?token=${token}&callbackURL=/app`,
      { headers: { "x-forwarded-for": "203.0.113.62" } },
    ),
  );

const sessionCookie = (setCookies: string[]) =>
  setCookies.find((c) => c.startsWith("better-auth.session_token="));

const wrongCode = (code: string) =>
  String((Number(code) + 1) % 1_000_000).padStart(6, "0");

describe("signing in with the code from the email", () => {
  it("signs in where the code was typed and uses up the link", async () => {
    await inRolledBackDb(async (db) => {
      const mail: Mail[] = [];
      const auth = instance(db, mail);
      expect(await ask(auth, "coder@example.test")).toBe("sent");
      const [sent] = mail;
      if (!sent) throw new Error("no email");

      const result = await enter(auth, "Coder@Example.test", sent.code);
      expect(result).toMatchObject({
        outcome: "signed-in",
        callbackURL: "/app/schedule",
      });
      if (result.outcome !== "signed-in") return;
      expect(sessionCookie(result.setCookies)).toBeDefined();

      // One sign-in: the link and the code are both used up.
      const link = await openLink(auth, sent.token);
      expect(link.headers.get("location")).toContain("error=INVALID_TOKEN");
      expect(await enter(auth, "coder@example.test", sent.code)).toMatchObject({
        outcome: "refused",
      });
    });
  });

  it("refuses the code once the link has been used", async () => {
    await inRolledBackDb(async (db) => {
      const mail: Mail[] = [];
      const auth = instance(db, mail);
      await ask(auth, "linker@example.test");
      const [sent] = mail;
      if (!sent) throw new Error("no email");
      const link = await openLink(auth, sent.token);
      expect(link.headers.get("location")).toBe(`${BASE}/app`);
      expect(await enter(auth, "linker@example.test", sent.code)).toMatchObject(
        { outcome: "refused" },
      );
    });
  });

  it("takes only the newest email's code, for that address", async () => {
    await inRolledBackDb(async (db) => {
      const mail: Mail[] = [];
      const auth = instance(db, mail);
      await ask(auth, "twice@example.test");
      await ask(auth, "twice@example.test");
      await ask(auth, "other@example.test");
      const [first, second, other] = mail;
      if (!first || !second || !other) throw new Error("no email");
      if (first.code !== second.code)
        expect(
          await enter(auth, "twice@example.test", first.code),
        ).toMatchObject({ outcome: "refused" });
      expect(
        await enter(
          auth,
          "twice@example.test",
          other.code === second.code ? wrongCode(other.code) : other.code,
        ),
      ).toMatchObject({ outcome: "refused" });
      expect(
        await enter(auth, "twice@example.test", second.code),
      ).toMatchObject({ outcome: "signed-in" });
      // The older email's link still works on its own.
      const link = await openLink(auth, first.token);
      expect(link.headers.get("location")).toBe(`${BASE}/app`);
    });
  });

  it("stops guesses for an address after five, from any IP, and the link still works", async () => {
    await inRolledBackDb(async (db) => {
      const mail: Mail[] = [];
      const auth = instance(db, mail);
      await ask(auth, "target@example.test");
      const [sent] = mail;
      if (!sent) throw new Error("no email");
      const bad = wrongCode(sent.code);
      for (let i = 0; i < 5; i += 1)
        expect(
          await enter(auth, "target@example.test", bad, `203.0.113.${70 + i}`),
        ).toMatchObject({ outcome: "refused" });
      // Even the right code waits now.
      expect(
        await enter(auth, "target@example.test", sent.code, "203.0.113.80"),
      ).toMatchObject({ outcome: "rate_limited" });
      const link = await openLink(auth, sent.token);
      expect(link.headers.get("location")).toBe(`${BASE}/app`);
    });
  });

  it("takes the code under a merged-away address, for the account it joined", async () => {
    await inRolledBackDb(async (db) => {
      const mail: Mail[] = [];
      const auth = instance(db, mail);
      const [kept, merged] = await db
        .insert(schema.user)
        .values([
          { name: "Kept", email: "kept@example.test", emailVerified: true },
          { name: "Old", email: "old-gone@example.test", emailVerified: true },
        ])
        .returning({ id: schema.user.id });
      await db.insert(schema.accountMerge).values({
        keptUserId: kept!.id,
        mergedUserId: merged!.id,
        mergedEmail: "old@example.test",
      });
      // The site's hook sends the link and code to the kept address.
      await ask(auth, "kept@example.test");
      const [sent] = mail;
      expect(await enter(auth, "Old@example.test", sent!.code)).toMatchObject({
        outcome: "signed-in",
      });
    });
  });

  it("stores only a keyed hash of the code", async () => {
    await inRolledBackDb(async (db) => {
      const mail: Mail[] = [];
      const auth = instance(db, mail);
      await ask(auth, "stored@example.test");
      const rows = await db.select().from(schema.verification);
      const codeRow = rows.find((r) =>
        r.identifier.startsWith("sign-in-code:"),
      );
      expect(codeRow).toBeDefined();
      expect(codeRow!.identifier).not.toContain("stored@");
      expect(codeRow!.value).not.toContain(`"${mail[0]!.code}"`);
      expect(codeRow!.value).not.toContain(mail[0]!.token);
    });
  });
});

describe("handing a browser sign-in to the app", () => {
  /** Signs in with a code and returns the session cookie, as the sheet would hold. */
  async function signedInSheet(auth: Auth, mail: Mail[], email: string) {
    await ask(auth, email, "203.0.113.90");
    const sent = mail.at(-1)!;
    const result = await enter(auth, email, sent.code, "203.0.113.91");
    if (result.outcome !== "signed-in") throw new Error("no session");
    return sessionCookie(result.setCookies)!.split(";")[0]!;
  }

  const handoff = (auth: Auth, cookies: string[], challenge: string) =>
    auth.handler(
      new Request(
        `${BASE}/api/auth/app-sign-in/handoff?challenge=${challenge}`,
        {
          headers: {
            cookie: cookies.join("; "),
            "x-forwarded-for": "203.0.113.92",
          },
        },
      ),
    );

  const redeem = (auth: Auth, code: string, verifier: string) =>
    auth.handler(
      new Request(`${BASE}/api/auth/app-sign-in/redeem`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: BASE,
          "x-forwarded-for": "203.0.113.93",
        },
        body: JSON.stringify({ code, verifier }),
      }),
    );

  it("returns to the app with a code only the app's verifier can use, once", async () => {
    await inRolledBackDb(async (db) => {
      const mail: Mail[] = [];
      const auth = instance(db, mail);
      const verifier = randomBytes(32).toString("base64url");
      const challenge = challengeFor(verifier);
      const start = `${HANDOFF_START_COOKIE}=${startCookieValue(challenge, Date.now() - 1000)}`;
      const session = await signedInSheet(auth, mail, "sheet@example.test");

      const back = await handoff(auth, [session, start], challenge);
      const location = back.headers.get("location") ?? "";
      expect(location.startsWith(`${SCHEME}:/sign-in?code=`)).toBe(true);
      const code = new URL(location).searchParams.get("code")!;
      // The sheet keeps nothing: its session is gone.
      const cleared = back.headers.getSetCookie().join("\n");
      expect(cleared).toMatch(/better-auth\.session_token=;/);

      // Another app with the code but not the verifier gets nothing, and
      // the code is gone afterwards.
      const thief = await redeem(
        auth,
        code,
        randomBytes(32).toString("base64url"),
      );
      expect(thief.status).toBe(400);
      expect((await redeem(auth, code, verifier)).status).toBe(400);
    });
  });

  it("signs the app in with the right verifier", async () => {
    await inRolledBackDb(async (db) => {
      const mail: Mail[] = [];
      const auth = instance(db, mail);
      const verifier = randomBytes(32).toString("base64url");
      const challenge = challengeFor(verifier);
      const start = `${HANDOFF_START_COOKIE}=${startCookieValue(challenge, Date.now() - 1000)}`;
      const session = await signedInSheet(auth, mail, "app@example.test");
      const back = await handoff(auth, [session, start], challenge);
      const code = new URL(back.headers.get("location")!).searchParams.get(
        "code",
      )!;
      const app = await redeem(auth, code, verifier);
      expect(app.status).toBe(200);
      expect(sessionCookie(app.headers.getSetCookie())).toBeDefined();
      expect((await redeem(auth, code, verifier)).status).toBe(400);
    });
  });

  it("refuses without the start cookie, with another challenge, or for an older sign-in", async () => {
    await inRolledBackDb(async (db) => {
      const mail: Mail[] = [];
      const auth = instance(db, mail);
      const challenge = challengeFor(randomBytes(32).toString("base64url"));
      const other = challengeFor(randomBytes(32).toString("base64url"));
      const session = await signedInSheet(auth, mail, "refuse@example.test");
      const startedLater = `${HANDOFF_START_COOKIE}=${startCookieValue(challenge, Date.now() + 60_000)}`;
      const started = `${HANDOFF_START_COOKIE}=${startCookieValue(challenge, Date.now() - 1000)}`;
      for (const [cookies, ch] of [
        [[session], challenge],
        [[session, started], other],
        [[session, startedLater], challenge],
        [[started], challenge],
      ] as const) {
        const back = await handoff(auth, [...cookies], ch);
        expect(back.headers.get("location")).toContain("/sign-in?app=expired");
      }
    });
  });
});
