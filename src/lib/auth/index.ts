import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import type { UserId } from "@/domain/ids";
import { env } from "@/env";
import {
  MAGIC_LINK_EXPIRES_IN_SECONDS,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_FRESH_AGE_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from "./config";
import { deliverMagicLink } from "./magic-link";
import { createProfileForUser } from "./profile";

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  advanced: { database: { generateId: "uuid" } },
  session: {
    expiresIn: SESSION_EXPIRES_IN_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
    freshAge: SESSION_FRESH_AGE_SECONDS,
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await createProfileForUser(db, user.id as UserId);
        },
      },
    },
  },
  plugins: [
    magicLink({
      expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
      sendMagicLink: async ({ email, url }) => {
        deliverMagicLink(
          { email, url },
          { nodeEnv: process.env.NODE_ENV, log: console.info },
        );
      },
    }),
    nextCookies(), // must stay last
  ],
});

export type Session = typeof auth.$Infer.Session;
