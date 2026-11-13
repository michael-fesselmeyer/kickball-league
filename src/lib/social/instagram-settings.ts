type Env = Readonly<Record<string, string | undefined>>;

export type InstagramAppSettings = { appId: string; appSecret: string };

export type InstagramSettings =
  | { on: true; app: InstagramAppSettings }
  | { on: false; reason: string | null };

const APP_ID = /^\d{6,20}$/;
const APP_SECRET = /^[A-Za-z0-9]{16,64}$/;

/**
 * The league's Instagram app, from the server's environment only. Read raw,
 * like DEMO_MODE (ADR 0004) and OPERATOR_USER_IDS (ADR 0009): the
 * connection is optional, so the variables stay out of the validated schema
 * and `.env.example`, and are checked here, where they are used
 * (ADR 0020).
 *
 * Off when both are unset (reason null). A half or malformed pair fails
 * safe: the connection stays off and `reason` names the variable, never
 * its value, for the server log and the admin screen.
 */
export function instagramSettings(env: Env): InstagramSettings {
  const appId = env.INSTAGRAM_APP_ID?.trim() || undefined;
  const appSecret = env.INSTAGRAM_APP_SECRET?.trim() || undefined;
  if (!appId && !appSecret) return { on: false, reason: null };
  if (!appId || !appSecret)
    return {
      on: false,
      reason: "Set both INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET, or neither.",
    };
  if (!APP_ID.test(appId))
    return {
      on: false,
      reason: "INSTAGRAM_APP_ID must be the Instagram app ID (digits).",
    };
  if (!APP_SECRET.test(appSecret))
    return {
      on: false,
      reason:
        "INSTAGRAM_APP_SECRET must be the Instagram app secret (16 to 64 letters and digits).",
    };
  return { on: true, app: { appId, appSecret } };
}
