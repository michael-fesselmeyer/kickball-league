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
});

export type Env = z.infer<typeof envSchema>;

type Source = Readonly<Record<string, string | undefined>>;

/** Treat empty strings as unset, so a blank line copied from .env.example counts as missing. */
const withoutBlanks = (source: Source): Source =>
  Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== ""),
  );

export function parseEnv(source: Source): Result<Env, string> {
  const parsed = envSchema.safeParse(withoutBlanks(source));
  return parsed.success ? ok(parsed.data) : err(z.prettifyError(parsed.error));
}

export function loadEnv(source: Source): Env {
  const result = parseEnv(source);
  if (!result.ok) {
    throw new Error(`Invalid environment variables:\n${result.error}`);
  }
  return result.value;
}
