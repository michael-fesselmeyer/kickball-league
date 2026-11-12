import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";
import { VIEW_AS_SESSION_SECONDS, viewAsPersona } from "../demo/view-as";

/**
 * Demo-only sign-in as a seeded persona (docs/adr/0004-demo-mode.md).
 *
 * The endpoint is server-only: Better Auth does not route it over HTTP, so
 * it is reachable only through the view-as Server Action. Its handler checks
 * demo mode on every call, so with demo mode off it refuses before touching
 * the database.
 */
export const demoViewAs = () =>
  ({
    id: "demo-view-as",
    endpoints: {
      demoViewAs: createAuthEndpoint(
        "/demo/view-as",
        {
          method: "POST",
          body: z.object({ persona: z.string() }),
          metadata: { SERVER_ONLY: true },
        },
        async (ctx) => {
          const result = await viewAsPersona(process.env, ctx.body.persona, {
            findUserByEmail: async (email) =>
              (await ctx.context.internalAdapter.findUserByEmail(email))
                ?.user ?? null,
            startSession: async (user) => {
              const session = await ctx.context.internalAdapter.createSession(
                user.id,
                true, // a browser-session cookie, not a remembered one
                {
                  expiresAt: new Date(
                    Date.now() + VIEW_AS_SESSION_SECONDS * 1000,
                  ),
                },
                true,
              );
              await setSessionCookie(ctx, { session, user }, true);
            },
          });
          if (result.ok) return ctx.json(result.value);
          switch (result.error.kind) {
            case "off":
              throw new APIError("NOT_FOUND");
            case "unknown_persona":
              throw new APIError("BAD_REQUEST", { message: "Unknown persona" });
            case "missing_persona":
              throw new APIError("SERVICE_UNAVAILABLE", {
                message: "The demo data is missing. Run the demo reset.",
              });
          }
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
