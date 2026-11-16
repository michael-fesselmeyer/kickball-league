import { createHash } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  getSessionFromCtx,
} from "better-auth/api";
import { deleteSessionCookie, setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { canonicalEmail } from "@/db/queries/account-merge";
import { consumeRateLimit } from "@/db/queries/rate-limit";
import type { Db } from "@/db/queries/schedule";
import {
  appCallbackUrl,
  HANDOFF_EXPIRES_IN_SECONDS,
  HANDOFF_START_COOKIE,
  HANDOFF_START_COOKIE_PATH,
  handoffIdentifier,
  isBase64Url256,
  isFreshForHandoff,
  newHandoffCode,
  parseHandoffRecord,
  parseStartCookie,
  verifierMatches,
} from "./app-handoff";
import {
  APP_HANDOFF_RATE,
  MAGIC_LINK_EXPIRES_IN_SECONDS,
  SIGN_IN_CODE_GUESSES,
  SIGN_IN_CODES_PER_IP,
} from "./config";
import {
  generateSignInCode,
  hashSignInCode,
  normalizeEmail,
  normalizeSignInCode,
  parseSignInCodeRecord,
  type SignInCodeRecord,
  signInCodeIdentifier,
  signInCodeMatches,
} from "./sign-in-code";

/** What a sign-in endpoint's context offers that this file uses. */
type Ctx = Parameters<typeof setSessionCookie>[0];

/** Better Auth stores a hashed link token as base64url(SHA-256(token)). */
const storedLinkToken = (token: string) =>
  createHash("sha256").update(token).digest("base64url");

/**
 * Makes the code that goes in the email with a sign-in link and stores its
 * keyed hash with the link it stands for. Called from `sendMagicLink`, so
 * code and link share the link's limits and lifetime. A newer email
 * replaces the address's code; its older links still work.
 */
export async function issueSignInCode(
  ctx: Ctx | undefined,
  link: { email: string; url: string; token: string },
): Promise<string> {
  if (!ctx) throw new Error("A sign-in code needs the request's context.");
  const code = generateSignInCode();
  const identifier = signInCodeIdentifier(link.email);
  const callbackURL = new URL(link.url).searchParams.get("callbackURL") ?? "/";
  const record: SignInCodeRecord = {
    type: "sign-in-code",
    email: normalizeEmail(link.email),
    codeHash: hashSignInCode(ctx.context.secret, link.email, code),
    link: storedLinkToken(link.token),
    callbackURL,
  };
  const adapter = ctx.context.internalAdapter;
  await adapter.deleteVerificationByIdentifier(identifier);
  await adapter.createVerificationValue({
    identifier,
    value: JSON.stringify(record),
    expiresAt: new Date(Date.now() + MAGIC_LINK_EXPIRES_IN_SECONDS * 1000),
  });
  return code;
}

const WRONG_CODE =
  "That code didn't work. Check the newest email and try again.";

/**
 * The sign-in plugin for codes and the apps (ADR 0075):
 *
 * - `POST /sign-in/code` signs in with the code from the email, and uses
 *   up the link it came with.
 * - `GET /app-sign-in/handoff` runs in the system browser sheet after
 *   Google sign-in: it signs the sheet out again and sends it back to the
 *   app with a one-time code.
 * - `POST /app-sign-in/redeem` trades that code and the app's verifier for
 *   a session in the app's web view.
 *
 * All three pass through Better Auth's router, so its per-IP limits apply;
 * code guesses are also capped per address.
 */
export function leagueSignIn(db: Db, options: { appScheme: string }) {
  return {
    id: "league-sign-in",
    endpoints: {
      signInWithCode: createAuthEndpoint(
        "/sign-in/code",
        {
          method: "POST",
          requireHeaders: true,
          body: z.object({ email: z.email(), code: z.string().max(20) }),
        },
        async (ctx) => {
          // A merged-away address's email went to the account it joined
          // (merged-alias.ts), and so did its code.
          const email = normalizeEmail(
            (await canonicalEmail(db, ctx.body.email)) ?? ctx.body.email,
          );
          const code = normalizeSignInCode(ctx.body.code);
          const now = new Date();
          const guessKey = signInCodeIdentifier(email).replace(
            "sign-in-code:",
            "sign-in-code-guess:",
          );
          const allowed =
            (await consumeRateLimit(
              db,
              guessKey,
              SIGN_IN_CODE_GUESSES.perLink,
              now,
            )) &&
            (await consumeRateLimit(
              db,
              `${guessKey}:day`,
              SIGN_IN_CODE_GUESSES.perDay,
              now,
            ));
          if (!allowed)
            throw new APIError("TOO_MANY_REQUESTS", {
              code: "too_many_guesses",
              message:
                "Too many tries for this address. Use the link in the email instead.",
            });
          const adapter = ctx.context.internalAdapter;
          const identifier = signInCodeIdentifier(email);
          const pending = await adapter.findVerificationValue(identifier);
          const record = pending ? parseSignInCodeRecord(pending.value) : null;
          if (
            !code ||
            !record ||
            !pending ||
            pending.expiresAt.getTime() < now.getTime() ||
            record.email !== email ||
            !signInCodeMatches(ctx.context.secret, email, code, record.codeHash)
          )
            throw new APIError("BAD_REQUEST", {
              code: "wrong_code",
              message: WRONG_CODE,
            });
          // Code and link are one sign-in: whichever comes first wins.
          const usedCode = await adapter.consumeVerificationValue(identifier);
          const usedLink = await adapter.consumeVerificationValue(
            `magic-link:${record.link}`,
          );
          if (!usedCode || !usedLink)
            throw new APIError("BAD_REQUEST", {
              code: "used",
              message:
                "That sign-in was already used. Ask for a new email to sign in again.",
            });
          let user = (await adapter.findUserByEmail(email))?.user;
          if (!user)
            // The code is the link's other half, so it signs up the same way.
            user = await adapter.createUser(
              { email, emailVerified: true, name: "" },
              { method: "magic-link" },
            );
          // Only Google and sign-in links make accounts, and both prove the
          // address; anything else is for the link's own checks.
          if (!user?.emailVerified)
            throw new APIError("BAD_REQUEST", {
              code: "use_link",
              message: "Use the link in the email to sign in.",
            });
          const session = await adapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ callbackURL: record.callbackURL });
        },
      ),

      appHandoff: createAuthEndpoint(
        "/app-sign-in/handoff",
        {
          method: "GET",
          requireHeaders: true,
          query: z.object({ challenge: z.string() }),
        },
        async (ctx) => {
          const back = (reason: string) =>
            ctx.redirect(`/sign-in?${new URLSearchParams({ app: reason })}`);
          const start = parseStartCookie(
            ctx.getCookie(HANDOFF_START_COOKIE) ?? undefined,
          );
          const session = await getSessionFromCtx(ctx);
          if (
            !start ||
            !isBase64Url256(ctx.query.challenge) ||
            start.challenge !== ctx.query.challenge ||
            !session ||
            !isFreshForHandoff(
              new Date(session.session.createdAt),
              start.startedAt,
              new Date(),
            )
          )
            throw back("expired");
          const code = newHandoffCode();
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: handoffIdentifier(code),
            value: JSON.stringify({
              type: "app-handoff",
              userId: session.user.id,
              challenge: start.challenge,
            }),
            expiresAt: new Date(Date.now() + HANDOFF_EXPIRES_IN_SECONDS * 1000),
          });
          // The sign-in belongs to the app; the sheet keeps nothing.
          await ctx.context.internalAdapter.deleteSession(
            session.session.token,
          );
          deleteSessionCookie(ctx);
          ctx.setCookie(HANDOFF_START_COOKIE, "", {
            path: HANDOFF_START_COOKIE_PATH,
            maxAge: 0,
            httpOnly: true,
            sameSite: "lax",
          });
          throw ctx.redirect(appCallbackUrl(options.appScheme, code));
        },
      ),

      appRedeem: createAuthEndpoint(
        "/app-sign-in/redeem",
        {
          method: "POST",
          requireHeaders: true,
          body: z.object({
            code: z.string().max(100),
            verifier: z.string().max(100),
          }),
        },
        async (ctx) => {
          const refused = () =>
            new APIError("BAD_REQUEST", {
              code: "handoff_refused",
              message: "That sign-in didn't come through. Try again.",
            });
          if (!isBase64Url256(ctx.body.code)) throw refused();
          const adapter = ctx.context.internalAdapter;
          // Used up whether or not the verifier matches: no second try.
          const row = await adapter.consumeVerificationValue(
            handoffIdentifier(ctx.body.code),
          );
          const record = row ? parseHandoffRecord(row.value) : null;
          if (
            !row ||
            !record ||
            row.expiresAt.getTime() < Date.now() ||
            !verifierMatches(ctx.body.verifier, record.challenge)
          )
            throw refused();
          const user = await adapter.findUserById(record.userId);
          if (!user) throw refused();
          const session = await adapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ ok: true });
        },
      ),
    },
    rateLimit: [
      {
        pathMatcher: (path: string) => path === "/sign-in/code",
        ...SIGN_IN_CODES_PER_IP,
      },
      {
        pathMatcher: (path: string) => path.startsWith("/app-sign-in/"),
        ...APP_HANDOFF_RATE,
      },
    ],
  } satisfies BetterAuthPlugin;
}
