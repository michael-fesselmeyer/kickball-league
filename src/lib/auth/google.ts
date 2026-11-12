/**
 * Google sign-in switches on only when both credentials are configured, so
 * the app works (email links only) before a Google OAuth client exists.
 */
type GoogleEnv = {
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
};

export function isGoogleEnabled(env: GoogleEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/** Better Auth's socialProviders option: Google when configured, nothing otherwise. */
export function socialProviders(env: GoogleEnv) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return {};
  return {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      // Shared phones and laptops: always let people pick which account.
      prompt: "select_account" as const,
    },
  };
}

/**
 * Someone who first signed in by email link and later uses Google with the
 * same verified address keeps one account. Only Google is trusted for this,
 * because it verifies the email it reports.
 */
export const accountLinking = { enabled: true, trustedProviders: ["google"] };
