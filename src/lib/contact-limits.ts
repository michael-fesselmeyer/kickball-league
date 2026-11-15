import { createHash } from "node:crypto";
import { db } from "@/db/client";
import { consumeRateLimit } from "@/db/queries/rate-limit";
import { PUBLIC_LIMITS } from "@/domain/concerns/concerns";
import { demoStatus } from "@/lib/demo/guard";

/** A key that holds no address: the limit table only ever sees a hash. */
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 32);

/**
 * Whether the public contact form may take one more message from this
 * network and, when given, this address, counting the attempt. Three
 * limits in the shared `rate_limit` table: per address, per network, and
 * everyone together, so a flood cannot use up the day's free email.
 */
export async function allowPublicConcern(
  network: string,
  email: string | null,
  now: Date,
): Promise<boolean> {
  if (demoStatus(process.env).on) return true;
  const checks = [
    consumeRateLimit(
      db,
      `contact:net:${digest(network)}`,
      PUBLIC_LIMITS.perNetwork,
      now,
    ),
    consumeRateLimit(db, "contact:all", PUBLIC_LIMITS.everyone, now),
    ...(email
      ? [
          consumeRateLimit(
            db,
            `contact:email:${digest(email)}`,
            PUBLIC_LIMITS.perEmail,
            now,
          ),
        ]
      : []),
  ];
  return (await Promise.all(checks)).every(Boolean);
}
