import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { parseId, type UserId } from "@/domain/ids";
import { env } from "@/env";
import { resendSender } from "@/services/email";
import {
  MAGIC_LINK_EXPIRES_IN_SECONDS,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_FRESH_AGE_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from "./config";
import { accountLinking, socialProviders } from "./google";
import { deliverMagicLink } from "./magic-link";
import { createProfileForUser } from "./profile";

/** Real email when Resend is configured; see deliverMagicLink otherwise. */
const send =
  env.RESEND_API_KEY && env.EMAIL_FROM
    ? resendSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM })
    : undefined;

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  advanced: { database: { generateId: "uuid" } },
  socialProviders: socialProviders(env),
  account: { accountLinking },
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
    nextCookies(), // must stay last
  ],
});

export type Session = typeof auth.$Infer.Session;
