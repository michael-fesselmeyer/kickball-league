import { createHash } from "node:crypto";
import { db } from "@/db/client";
import { consumeRateLimit } from "@/db/queries/rate-limit";
import { demoStatus } from "@/lib/demo/guard";

/** A key that holds no address: the limit table only ever sees a hash. */
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 32);

/**
 * Limits on the two public guest forms, in the shared `rate_limit` table:
 * team sign-ups per network and per email address, waiver signatures per
 * link, and everyone together so a flood cannot fill the database.
 */
export const GUEST_LIMITS = {
  signupPerNetwork: { windowSeconds: 24 * 60 * 60, max: 10 },
  signupPerEmail: { windowSeconds: 24 * 60 * 60, max: 3 },
  signupEveryone: { windowSeconds: 60 * 60, max: 60 },
  /** A team's roster is at most 30, so this leaves room for retries. */
  signPerLink: { windowSeconds: 24 * 60 * 60, max: 60 },
  signPerNetwork: { windowSeconds: 60 * 60, max: 40 },
} as const;

export async function allowGuestSignup(
  network: string,
  email: string,
  now: Date,
): Promise<boolean> {
  if (demoStatus(process.env).on) return true;
  const checks = await Promise.all([
    consumeRateLimit(
      db,
      `guest:signup:net:${digest(network)}`,
      GUEST_LIMITS.signupPerNetwork,
      now,
    ),
    consumeRateLimit(
      db,
      `guest:signup:email:${digest(email)}`,
      GUEST_LIMITS.signupPerEmail,
      now,
    ),
    consumeRateLimit(db, "guest:signup:all", GUEST_LIMITS.signupEveryone, now),
  ]);
  return checks.every(Boolean);
}

export async function allowGuestSignature(
  network: string,
  token: string,
  now: Date,
): Promise<boolean> {
  if (demoStatus(process.env).on) return true;
  const checks = await Promise.all([
    consumeRateLimit(
      db,
      `guest:sign:link:${digest(token)}`,
      GUEST_LIMITS.signPerLink,
      now,
    ),
    consumeRateLimit(
      db,
      `guest:sign:net:${digest(network)}`,
      GUEST_LIMITS.signPerNetwork,
      now,
    ),
  ]);
  return checks.every(Boolean);
}
