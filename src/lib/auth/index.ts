import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { parseId, type UserId } from "@/domain/ids";
import { canWrite } from "@/domain/platform/operator";
import { env } from "@/env";
import { currentSite, isCurrentOperator } from "@/lib/platform/site";
import { SITE } from "@/lib/site";
import { resendSender } from "@/services/email";
import {
  MAGIC_LINK_EXPIRES_IN_SECONDS,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_FRESH_AGE_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from "./config";
import { demoViewAs } from "./demo-view-as";
import { accountLinking, socialProviders } from "./google";
import { deliverMagicLink } from "./magic-link";
import {
  PASSKEY_DISABLED_PATHS,
  PASSKEY_REGISTRATION_PATHS,
  passkeyRegistrationRefusal,
  REGISTRATION_REFUSALS,
  relyingParty,
} from "./passkey-policy";
import { createProfileForUser } from "./profile";
import { replacePreviousSession } from "./replace-session";

/** Real email when Resend is configured; see deliverMagicLink otherwise. */
const send =
  env.RESEND_API_KEY && env.EMAIL_FROM
    ? resendSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM })
    : undefined;

/** Adding a passkey needs a fresh sign-in (passkey-policy.ts). */
const guardPasskeyRegistration = createAuthMiddleware(async (ctx) => {
  if (!PASSKEY_REGISTRATION_PATHS.includes(ctx.path)) return;
  const session = await getSessionFromCtx(ctx);
  const site = session ? await currentSite() : null;
  const refusal = passkeyRegistrationRefusal({
    signedInAt: session ? new Date(session.session.createdAt) : null,
    now: new Date(),
    writable:
      !site || canWrite(site.status, isCurrentOperator(session!.user.id)),
  });
  if (refusal)
    throw new APIError(
      refusal === "signed_out" ? "UNAUTHORIZED" : "FORBIDDEN",
      {
        code: refusal,
        message: REGISTRATION_REFUSALS[refusal],
      },
    );
});

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  advanced: { database: { generateId: "uuid" } },
  socialProviders: socialProviders(env),
  account: { accountLinking },
  disabledPaths: [...PASSKEY_DISABLED_PATHS],
  hooks: { before: guardPasskeyRegistration },
  session: {
    expiresIn: SESSION_EXPIRES_IN_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
    freshAge: SESSION_FRESH_AGE_SECONDS,
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const id = parseId<UserId>(user.id);
          if (!id) throw new Error("Expected a UUID account id");
          await createProfileForUser(db, id);
        },
      },
    },
    session: {
      create: { after: replacePreviousSession },
    },
  },
  plugins: [
    magicLink({
      expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
      sendMagicLink: async ({ email, url }) => {
        await deliverMagicLink(
          { email, url },
          { nodeEnv: process.env.NODE_ENV, log: console.info, send },
        );
      },
    }),
    passkey({ ...relyingParty(env.BETTER_AUTH_URL), rpName: SITE.name }),
    demoViewAs(), // refuses everything unless demo mode is on
    nextCookies(), // must stay last
  ],
});

export type Session = typeof auth.$Infer.Session;
