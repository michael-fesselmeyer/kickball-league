import { createHash } from "node:crypto";
import { db } from "@/db/client";
import { consumeRateLimit } from "@/db/queries/rate-limit";
import { PUBLIC_LIMITS } from "@/domain/interest/interest";
import { demoStatus } from "@/lib/demo/guard";

/** A key that holds no address: the limit table only ever sees a hash. */
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 32);

/**
 * Whether the public interest form may take one more answer from this
 * network and address, counting the attempt. Three limits in the shared
 * `rate_limit` table: per address, per network, and everyone together. The
 * form sends no email itself, so these only stop floods and one address
 * flipping its answer over and over.
 */
export async function allowInterestAnswer(
  network: string,
  email: string,
  now: Date,
): Promise<boolean> {
  if (demoStatus(process.env).on) return true;
  const checks = [
    consumeRateLimit(
      db,
      `interest:net:${digest(network)}`,
      PUBLIC_LIMITS.perNetwork,
      now,
    ),
    consumeRateLimit(db, "interest:all", PUBLIC_LIMITS.everyone, now),
    consumeRateLimit(
      db,
      `interest:email:${digest(email)}`,
      PUBLIC_LIMITS.perEmail,
      now,
    ),
  ];
  return (await Promise.all(checks)).every(Boolean);
}
