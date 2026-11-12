import { timingSafeEqual } from "node:crypto";
import { txDb } from "@/db/client";
import { finalizeDueScores } from "@/db/queries/scores";
import { env } from "@/env";

/** Constant-time comparison, so the secret cannot be guessed by timing. */
function matches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Daily job: finalizes every score that has gone 24 hours without a dispute
 * (roadmap week 5). Vercel Cron calls it with `Authorization: Bearer
 * $CRON_SECRET`; anything else is refused.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = env.CRON_SECRET;
  if (!secret) return new Response("Jobs are not configured", { status: 503 });
  const auth = request.headers.get("authorization") ?? "";
  if (!matches(auth, `Bearer ${secret}`))
    return new Response("Unauthorized", { status: 401 });
  const finalized = await txDb.transaction((tx) =>
    finalizeDueScores(tx, new Date()),
  );
  return Response.json({ finalized });
}
