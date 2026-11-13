import { env } from "@/env";
import { demoStatus } from "@/lib/demo/guard";
import {
  authorizeUrl,
  type InstagramApp,
  type InstagramFetch,
} from "@/services/instagram";
import {
  fixtureFetch,
  usesInstagramFixture,
} from "@/services/instagram-fixture";

/**
 * The Instagram connection's settings, or null when it is off: neither a
 * real app (INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET) nor the recorded
 * fixture is configured. With it off, the admin screen says so, the jobs
 * skip, and photos already synced stay as they are.
 */
export type InstagramConfig = InstagramApp & { fixture: boolean };

export function instagramConfig(
  source: Readonly<Record<string, string | undefined>> = process.env,
): InstagramConfig | null {
  if (env.INSTAGRAM_APP_ID && env.INSTAGRAM_APP_SECRET)
    return {
      appId: env.INSTAGRAM_APP_ID,
      appSecret: env.INSTAGRAM_APP_SECRET,
      fetch: fetch as InstagramFetch,
      fixture: false,
    };
  if (usesInstagramFixture(source, demoStatus(source).on))
    return {
      appId: "fixture",
      appSecret: "fixture",
      fetch: fixtureFetch(),
      fixture: true,
    };
  return null;
}

export const CALLBACK_PATH = "/app/admin/instagram/callback";

export const redirectUri = () =>
  new URL(CALLBACK_PATH, env.BETTER_AUTH_URL).toString();

/** Where "Connect Instagram" sends the admin: Instagram's own sign-in. */
export const signInUrl = (config: InstagramConfig, state: string): string =>
  authorizeUrl({ appId: config.appId, redirectUri: redirectUri(), state });
