// Pure helpers for `npm run demo` (scripts/demo.mjs), kept apart so they can
// be tested without starting anything.
import { createECDH, createHash, randomBytes } from "node:crypto";

/** The demo database: its name must contain "demo" (docs/adr/0004-demo-mode.md). */
export const DEMO_DATABASE = "kb_demo";
export const DEMO_ROLE = "kb_demo";
/** The demo admin persona (src/seed/demo-personas.ts): also sees the owner's screens. */
export const DEMO_ADMIN_ID = "d3e30000-0000-4000-8000-000000000004";
export const STRIPE_MOCK_IMAGE = "stripe/stripe-mock:v0.197.0";
export const POSTGRES_IMAGE = "postgres:18";

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");

/** A P-256 key pair for web push, in the form src/lib/env.ts accepts. */
export function vapidKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const scalar = ecdh.getPrivateKey();
  return {
    publicKey: b64url(ecdh.getPublicKey()),
    privateKey: b64url(
      Buffer.concat([Buffer.alloc(32 - scalar.length), scalar]),
    ),
  };
}

/**
 * The demo's throwaway secrets: the ones already saved, and new ones for
 * anything missing. They protect nothing but this computer's demo.
 */
export function demoSecrets(saved = {}) {
  const keys =
    saved.VAPID_PUBLIC_KEY && saved.VAPID_PRIVATE_KEY
      ? {
          publicKey: saved.VAPID_PUBLIC_KEY,
          privateKey: saved.VAPID_PRIVATE_KEY,
        }
      : vapidKeys();
  return {
    AUTH_SECRET: saved.AUTH_SECRET ?? b64url(randomBytes(32)),
    WEBHOOK_SECRET:
      saved.WEBHOOK_SECRET ?? `whsec_${randomBytes(24).toString("hex")}`,
    CRON_SECRET: saved.CRON_SECRET ?? b64url(randomBytes(24)),
    PG_PASSWORD: saved.PG_PASSWORD ?? randomBytes(18).toString("hex"),
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
  };
}

/** Reads KEY=value lines; anything else is skipped. */
export function parseEnvFile(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  return values;
}

export function formatEnvFile(values) {
  return [
    "# Throwaway secrets for this computer's demo (npm run demo). Not used anywhere else.",
    ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
    "",
  ].join("\n");
}

/** Preloaded into the demo's processes: hides every `.env*` file from them. */
export const HIDE_ENV_PRELOAD = new URL("./demo-hide-env.mjs", import.meta.url)
  .href;

/** The only variables the demo's processes inherit from the shell. */
const PASS_THROUGH = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "TERM",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
  "APPDATA",
  "LOCALAPPDATA",
];

/**
 * Everything the demo's server, build and reset see. Built from nothing
 * rather than from the shell, and with `.env.local` switched off, so none
 * of the league's own keys can reach the demo (see HIDE_ENV_PRELOAD). Payments are on only with
 * stripe-mock; without it, paying says it is a demo payment.
 */
export function demoEnv({ shell, secrets, databaseUrl, port, stripeMockUrl }) {
  const env = {};
  for (const key of PASS_THROUGH) if (shell[key]) env[key] = shell[key];
  Object.assign(env, {
    // Next.js and drizzle-kit skip loading .env files when this is set.
    __NEXT_PROCESSED_ENV: "true",
    // Next.js reloads env files on a build even with the flag above, so the
    // files are also hidden from every process (scripts/demo-hide-env.mjs).
    NODE_OPTIONS: `--import "${HIDE_ENV_PRELOAD}"`,
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_URL: `http://localhost:${port}`,
    BETTER_AUTH_SECRET: secrets.AUTH_SECRET,
    CRON_SECRET: secrets.CRON_SECRET,
    VAPID_PUBLIC_KEY: secrets.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: secrets.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: "mailto:demo@example.test",
    DEMO_MODE: "true",
    OPERATOR_USER_IDS: DEMO_ADMIN_ID,
    INSTAGRAM_FIXTURE: "true",
    WEATHER_FIXTURE: "true",
  });
  if (stripeMockUrl)
    Object.assign(env, {
      STRIPE_SECRET_KEY: "sk_test_localdemo",
      STRIPE_WEBHOOK_SECRET: secrets.WEBHOOK_SECRET,
      STRIPE_MOCK_URL: stripeMockUrl,
      DEMO_CHECKOUT: "true",
    });
  return env;
}

export function databaseUrl({ host, port, password }) {
  return `postgresql://${DEMO_ROLE}:${encodeURIComponent(password)}@${host}:${port}/${DEMO_DATABASE}`;
}

/**
 * What a build depends on: the code, the day (the demo's dates follow
 * today) and the address it runs at. A build with the same key is still
 * fresh and can be reused with its data.
 */
export function buildKey({ commit, changes, day, port, database, brand = "" }) {
  return createHash("sha256")
    .update(JSON.stringify({ commit, changes, day, port, database, brand }))
    .digest("hex")
    .slice(0, 16);
}
