// Relative imports only: next.config.ts loads this file, and the @/ alias does not resolve there.
import { z } from "zod";
import { err, ok, type Result } from "../domain/result";

/**
 * Every environment variable the server reads, validated once at startup.
 * A missing or malformed value fails `next build` and `next start` with the
 * variable's name, instead of failing a request later.
 * See docs/architecture.md, section 10 ("Environments").
 *
 * Keep this in step with .env.example; a test enforces it.
 */
/** Says "is required" when the variable is unset, and the format hint otherwise. */
const message = (hint: string) => (issue: { input: unknown }) =>
  issue.input === undefined ? "is required" : hint;

export const envSchema = z.object({
  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    error: message("must be a postgres:// or postgresql:// connection string"),
  }),
  BETTER_AUTH_SECRET: z.string({ error: message("must be a string") }).min(32, {
    error: "must be at least 32 characters (try `openssl rand -base64 32`)",
  }),
  BETTER_AUTH_URL: z.url({
    protocol: /^https?$/,
    error: message("must be an http(s) URL"),
  }),
  // Optional until Google sign-in lands (issue #8).
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  // Optional until email is set up: without them, sign-in links are printed
  // in development and refused in production.
  RESEND_API_KEY: z
    .string()
    .startsWith("re_", { error: "must be a Resend API key (starts with re_)" })
    .optional(),
  EMAIL_FROM: z
    .string()
    .regex(/^(?:[^<>]+ <)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/, {
      error: 'must be an address, like "League <hello@example.com>"',
    })
    .optional(),
});

/** Google and email each need both values; one without the other is a mistake. */
const pairs = envSchema
  .refine(
    (env) =>
      Boolean(env.GOOGLE_CLIENT_ID) === Boolean(env.GOOGLE_CLIENT_SECRET),
    {
      error: "set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither",
      path: ["GOOGLE_CLIENT_SECRET"],
    },
  )
  .refine((env) => Boolean(env.RESEND_API_KEY) === Boolean(env.EMAIL_FROM), {
    error: "set both RESEND_API_KEY and EMAIL_FROM, or neither",
    path: ["EMAIL_FROM"],
  });

export type Env = z.infer<typeof envSchema>;

type Source = Readonly<Record<string, string | undefined>>;

/** Treat empty strings as unset, so a blank line copied from .env.example counts as missing. */
const withoutBlanks = (source: Source): Source =>
  Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== ""),
  );

/**
 * On Vercel, BETTER_AUTH_URL can be left unset: production uses the project's
 * production domain and every preview uses its own deployment address, which
 * a fixed value could not cover. An explicit value always wins.
 */
export function withVercelDefaults(source: Source): Source {
  if (source.BETTER_AUTH_URL) return source;
  const host =
    source.VERCEL_ENV === "production"
      ? source.VERCEL_PROJECT_PRODUCTION_URL
      : source.VERCEL_ENV === "preview"
        ? (source.VERCEL_BRANCH_URL ?? source.VERCEL_URL)
        : undefined;
  return host ? { ...source, BETTER_AUTH_URL: `https://${host}` } : source;
}

export function parseEnv(source: Source): Result<Env, string> {
  const parsed = pairs.safeParse(withVercelDefaults(withoutBlanks(source)));
  return parsed.success ? ok(parsed.data) : err(z.prettifyError(parsed.error));
}

export function loadEnv(source: Source): Env {
  const result = parseEnv(source);
  if (!result.ok) {
    throw new Error(`Invalid environment variables:\n${result.error}`);
  }
  return result.value;
}
